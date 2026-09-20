from __future__ import annotations

import threading
from typing import Any

from app.models.schemas import Session

_session_ok_lock = threading.Lock()


class InMemoryStore:
    """Dev-grade in-memory session store.

    Lost on restart and single-process only. Swap for Postgres/Redis once you
    move past prototyping.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = _session_ok_lock

    def save(self, session: Session) -> Session:
        with self._lock:
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            return self._sessions.get(session_id)

    def upsert_history(self, session_id: str, entries: list[dict[str, Any]]) -> None:
        with self._lock:
            s = self._sessions.get(session_id)
            if s is not None:
                s.history = entries


store = InMemoryStore()