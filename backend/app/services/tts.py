"""Text-to-speech for the AI's lines (edge-tts, free, no API key).

Synthesises the tutor's Swahili reply as MP3 bytes so the frontend can
play it back instead of relying on the browser's built-in SpeechSynthesis.

Two entry points
----------------
synthesize(text)
    Plain Swahili text → sw-KE-ZuriNeural MP3.  Used for ai_text.

synthesize_codeswitched(segments)
    A list of (text, lang) pairs → concatenated MP3.  Each segment is
    rendered with the appropriate voice, then the byte streams are joined.
    Used for correction / feedback narration where English words appear
    inside a Swahili sentence.

Code-switch strategy
--------------------
edge-tts cannot switch voices mid-utterance via SSML.  Instead we:

1.  Parse the mixed string into typed segments:
        "Sema mzee" (sw)  "— In Swahili, 'old man'" (en)
2.  Synthesise each segment independently with its voice.
3.  Concatenate the raw MP3 byte streams (valid because each chunk is a
    self-contained MPEG frame sequence that audio decoders handle fine).
4.  Cache the whole result per (voice, text) so repeat playbacks are free.

Language detection heuristic (fast, no external libs)
------------------------------------------------------
-  Text inside straight/curly quotes → English (quoted corrections).
-  Text after " — " or " – " → English (explanation clause).
-  Remaining text checked against a tiny Swahili function-word set;
   if it matches → Swahili, else English.
-  The ai_text (pure Swahili reply) always goes through the single-voice
   path — no detection overhead.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import io
import logging
import re
from functools import lru_cache
from typing import Literal

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

EMPTY = b""

# Voices
VOICE_SW = "sw-KE-ZuriNeural"       # primary: Swahili neural voice
VOICE_EN = "en-GB-SoniaNeural"      # code-switch: British English (closer prosody to East African English than en-US)

# Swahili function words AND common content words used for language detection.
# Kept broad intentionally — false-positives (wrongly marking English as Swahili)
# are less harmful than false-negatives since the Swahili voice handles
# Swahili-accented English better than an English voice handles Swahili.
_SW_MARKERS = frozenset(
    # function words / particles
    "na kwa ya wa ni ku si la pia au bali hata lakini ama ingawa"
    " vipi jambo habari sawa ndiyo hapana asante tafadhali karibu"
    # pronouns / agreement markers
    " una yeye wao mimi wewe sisi ninyi mimi yako yangu yake yetu"
    # common nouns (likely to appear in corrections)
    " mzee kaka dada mtoto mtu watu nyumba shule chakula maji"
    " bei pesa shilingi soko duka hospitali gari barabara"
    # common verbs / infinitives
    " sema soma lala kula nunua penda taka jua jaribu piga"
    " enda nenda rudi acha angalia simama subiri ambia omba"
    # common adjectives / adverbs
    " nzuri mbaya kubwa ndogo nyingi kidogo sana zaidi haraka"
    " polepole bado tena sasa hapa pale leo jana kesho"
    # greetings / interjections
    " habari mambo aha pole sijui nadhani kweli kwamba".split()
)

Lang = Literal["sw", "en"]


# ─── Public API ──────────────────────────────────────────────────────────────

def synthesize(text: str, *, voice: str | None = None) -> bytes:
    """Return MP3 for plain Swahili text (or empty bytes when TTS is off)."""
    settings: Settings = get_settings()
    if settings.tts_engine == "none" or not text or not text.strip():
        return EMPTY
    _voice = voice or settings.tts_voice
    return _synth_cached(text.strip(), _voice, settings.tts_rate)


def synthesize_codeswitched(text: str) -> bytes:
    """
    Segment *text* by language and concatenate MP3 audio from the
    appropriate voice for each segment.

    Falls back to plain synthesize() when no English segments are detected.
    """
    settings: Settings = get_settings()
    if settings.tts_engine == "none" or not text or not text.strip():
        return EMPTY

    segments = _segment(text.strip())

    # If everything is Swahili, use the fast single-voice path
    if all(lang == "sw" for _, lang in segments):
        return synthesize(text)

    chunks: list[bytes] = []
    for seg_text, lang in segments:
        if not seg_text.strip():
            continue
        voice = VOICE_SW if lang == "sw" else VOICE_EN
        chunk = _synth_cached(seg_text.strip(), voice, settings.tts_rate)
        if chunk:
            chunks.append(chunk)

    if not chunks:
        return EMPTY
    return b"".join(chunks)


# ─── Language segmentation ───────────────────────────────────────────────────

def _segment(text: str) -> list[tuple[str, Lang]]:
    """
    Split *text* into (segment_text, lang) pairs.

    Rules (applied in order):
    1.  A " — " or " – " dash introduces an English explanation clause.
    2.  Quoted spans (single or double quotes, straight or curly) are English.
    3.  Remaining unquoted spans are classified by _is_english().
    """
    segments: list[tuple[str, Lang]] = []

    # Rule 1: split on an em-dash / en-dash explanation clause
    # Correction format is always: "Swahili word — English explanation"
    # so we force the left side to Swahili, right side to English.
    dash_match = re.search(r"\s[—–-]{1,2}\s", text)
    if dash_match:
        sw_part = text[: dash_match.start()]
        en_part = text[dash_match.end() :]
        if sw_part.strip():
            # Left side: always the Swahili word/phrase being discussed
            segments.extend(_segment_quotes(sw_part, force_lang="sw"))
        if en_part.strip():
            # Right side: always the English explanation, may contain quoted Swahili words
            segments.extend(_segment_quotes(en_part, force_lang="en"))
        return segments

    return _segment_quotes(text)


def _segment_quotes(text: str, force_lang: Lang | None = None) -> list[tuple[str, Lang]]:
    """
    Split text into alternating unquoted / quoted spans.
    Quoted spans are always English; unquoted spans use force_lang or detection.
    """
    # Match single/double straight or curly quotes
    quote_re = re.compile(r"([\"'\u2018\u2019\u201c\u201d])(.+?)\1")
    segments: list[tuple[str, Lang]] = []
    cursor = 0

    for m in quote_re.finditer(text):
        before = text[cursor : m.start()]
        quoted = m.group(2)
        if before.strip():
            lang: Lang = force_lang or ("en" if _is_english(before) else "sw")
            segments.append((before, lang))
        # Quoted words are almost always the foreign-language correction example
        segments.append((quoted, "en"))
        cursor = m.end()

    tail = text[cursor:]
    if tail.strip():
        lang = force_lang or ("en" if _is_english(tail) else "sw")
        segments.append((tail, lang))

    return segments if segments else [(text, force_lang or "sw")]


def _is_english(text: str) -> bool:
    """
    Heuristic: return True if *text* reads as English.

    Checks whether ANY Swahili function word appears in the lowercase token
    set. If none match, treat as English.
    """
    tokens = set(re.sub(r"[^a-zA-Z\s]", " ", text).lower().split())
    return not bool(tokens & _SW_MARKERS)


# ─── Core synthesis (cached) ─────────────────────────────────────────────────

@lru_cache(maxsize=256)
def _synth_cached(text: str, voice: str, rate: str) -> bytes:
    try:
        audio = _run(_stream(_communicate(text, voice, rate)))
    except Exception as exc:
        logger.warning("TTS failed for %r (voice=%s): %s", text[:40], voice, exc)
        return EMPTY
    return audio or EMPTY


def _communicate(text: str, voice: str, rate: str):
    """Late import keeps edge-tts optional."""
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