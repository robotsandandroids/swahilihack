"""LlamaIndex-backed conversation memory with cost controls.

Implements the memory ideas from part_2.md:

- :class:`SummarizingMemory` wraps ``ChatMemoryBuffer`` and, every N user
  turns, collapses old history into a 2-3 sentence summary instead of just
  dropping it - so long sessions stop paying full token cost for early turns.
  The buffer's token limit is the safety net for a single turn.
- :class:`ErrorCache` remembers ``(error_type, root)`` patterns so a repeated
  mistake can be marked ``repeat_error=true`` and get a one-line reminder
  instead of a full re-teach (a big token saver for learners who repeat).
- :class:`MemoryRegistry` owns one memory + error cache per session and can
  rebuild the memory from the persisted ``session.history`` snapshot (a
  SimpleChatStore-style restore: structured messages, no re-embedding).
"""

from __future__ import annotations

import threading
from typing import Any

from llama_index.core.llms import ChatMessage, MessageRole
from llama_index.core.memory import ChatMemoryBuffer

from app.core.config import Settings, get_settings

SUMMARY_MARKER = "[Early-conversation summary] "


class ErrorCache:
    """Tracks repeated (error_type, root) patterns across a session."""

    def __init__(self) -> None:
        self._seen: dict[tuple[str, str], int] = {}

    def check_and_record(self, error_type: str, root: str) -> bool:
        """Record a pattern; return True if it was already seen before."""
        if not root:
            return False
        key = (error_type, root)
        is_repeat = key in self._seen
        self._seen[key] = self._seen.get(key, 0) + 1
        return is_repeat

    def counts(self) -> dict[tuple[str, str], int]:
        return dict(self._seen)


class SummarizingMemory:
    """ChatMemoryBuffer + periodic summarization of old turns."""

    def __init__(
        self,
        llm,
        token_limit: int | None = None,
        summarize_every: int | None = None,
        keep_recent: int | None = None,
    ) -> None:
        settings: Settings = get_settings()
        self.llm = llm
        self.token_limit = token_limit or settings.memory_token_limit
        self.summarize_every = summarize_every or settings.memory_summarize_every
        self.keep_recent = keep_recent or settings.memory_keep_recent
        self.buffer = ChatMemoryBuffer.from_defaults(token_limit=self.token_limit)
        self._turn_count = 0
        self._summary: str | None = None

    # --- writes -----------------------------------------------------------
    def put(self, message: ChatMessage) -> None:
        self.buffer.put(message)
        if message.role == MessageRole.USER:
            self._turn_count += 1
            if self._turn_count > 0 and self._turn_count % self.summarize_every == 0:
                self._maybe_summarize()

    @classmethod
    def from_history(
        cls,
        llm,
        history: list[dict[str, Any]],
        token_limit: int | None = None,
        summarize_every: int | None = None,
        keep_recent: int | None = None,
    ) -> "SummarizingMemory":
        """Rebuild from a persisted history snapshot (turn restoration)."""
        inst = cls(llm, token_limit, summarize_every, keep_recent)
        summary_text: str | None = None
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")
            if content.startswith(SUMMARY_MARKER):
                summary_text = content
                continue
            inst._put_restored(role, content)
        inst._summary = summary_text
        if summary_text is not None:
            inst.buffer.put(ChatMessage(role=MessageRole.SYSTEM, content=summary_text))
        return inst

    def _put_restored(self, role: str, content: str) -> None:
        try:
            msg_role = MessageRole(role)
        except ValueError:
            msg_role = MessageRole.USER
        if msg_role == MessageRole.USER:
            self._turn_count += 1
        self.buffer.put(ChatMessage(role=msg_role, content=content))

    @property
    def turn_count(self) -> int:
        return self._turn_count

    # --- reads ------------------------------------------------------------
    def get(self) -> list[ChatMessage]:
        return self.buffer.get()

    def to_history(self) -> list[dict[str, str]]:
        """Structured snapshot for persistence; rebuildable via from_history."""
        return [{"role": m.role.value, "content": m.content} for m in self.buffer.get()]

    def summary(self) -> str | None:
        return self._summary

    # --- summarization ----------------------------------------------------
    def _maybe_summarize(self) -> None:
        history = self.buffer.get()
        if len(history) <= self.keep_recent * 2:
            return  # not enough to bother summarizing yet

        old, recent = history[: -self.keep_recent * 2], history[-self.keep_recent * 2 :]
        old_text = "\n".join(f"{m.role.value}: {m.content}" for m in old)

        prompt = (
            "Summarize this Swahili-tutoring conversation in 2-3 short "
            "sentences. Note any recurring grammar mistakes the learner made "
            "and topics covered. Be terse.\n\n" + old_text
        )
        try:
            summary_resp = self.llm.complete(prompt, max_tokens=120)
            self._summary = str(summary_resp)
        except Exception:
            # Never let a summarization hiccup kill the turn; the buffer's
            # token limit still protects us from runaway growth.
            return

        # Rebuild: summary note + recent turns verbatim.
        self.buffer.reset()
        if self._summary:
            self.buffer.put(ChatMessage(
                role=MessageRole.SYSTEM,
                content=f"{SUMMARY_MARKER}{self._summary}",
            ))
        for m in recent:
            self.buffer.put(m)


# --- per-session registry -------------------------------------------------

_store_lock = threading.Lock()
_memories: dict[str, SummarizingMemory] = {}
_error_caches: dict[str, ErrorCache] = {}


class MemoryRegistry:
    """Owns memory + error cache per session, rebuildable from history."""

    def __init__(self, store) -> None:
        self._store = store

    def memory_for(self, session_id: str, llm) -> SummarizingMemory:
        with _store_lock:
            cached = _memories.get(session_id)
            if cached is not None:
                return cached
            session = self._store.get(session_id)
            history = session.history if session is not None else []
            memory = SummarizingMemory.from_history(llm, history)
            _memories[session_id] = memory
            return memory

    def error_cache_for(self, session_id: str) -> ErrorCache:
        with _store_lock:
            return _error_caches.setdefault(session_id, ErrorCache())

    def drop(self, session_id: str) -> None:
        with _store_lock:
            _memories.pop(session_id, None)
            _error_caches.pop(session_id, None)