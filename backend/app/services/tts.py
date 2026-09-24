"""Text-to-speech for the AI's lines (edge-tts, free, no API key).

Synthesizes the tutor's Swahili reply as MP3 bytes so a caller can play it
back — the showcase uses it for spoken audio on top of the rendered text.

Bundled with every turn:

- quality enough for robust ASR-to-TTS round-trip testing (Microsoft's
  neural Swahili voices, ``sw-KE-*``/``sw-TZ-*``);
- no API key; set ``TTS_ENGINE=none`` to disable and ``TTS_VOICE`` to pick a
  voice;
- cached per (text, voice, rate) so UI reruns don't re-fetch already-seen
  utterances.

Fallback behaviour: an empty ``bytes`` is returned for empty text or when
TTS is disabled, so callers can degrade gracefully offline.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import io
import logging
from functools import lru_cache

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Mark so uvicorn threading guards/tests can tell when TTS did nothing.
EMPTY = b""


def synthesize(text: str) -> bytes:
    """Return MP3 audio for ``text`` (length 0 if TTS is off/empty text)."""
    settings: Settings = get_settings()
    if settings.tts_engine == "none" or not text or not text.strip():
        return EMPTY
    return _synthesize_cached(text.strip(), settings.tts_voice, settings.tts_rate)


@lru_cache(maxsize=128)
def _synthesize_cached(text: str, voice: str, rate: str) -> bytes:
    try:
        audio = _run(
            _stream(edge_tts_communicate(text, voice, rate))
        )
    except Exception as exc:  # no network / Microsoft service hiccup
        logger.warning("TTS failed for %r: %s", text[:40], exc)
        return EMPTY
    return audio or EMPTY


def edge_tts_communicate(text: str, voice: str, rate: str):
    """Late import keeps edge-tts optional (only needed when TTS is on)."""
    import edge_tts

    return edge_tts.Communicate(text, voice, rate=rate)


async def _stream(communicate) -> bytes:
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


def _run(coro) -> bytes:
    """Run a coroutine even if an event loop is already running (uvicorn)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()