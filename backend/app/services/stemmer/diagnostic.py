"""Deterministic, local sentence diagnostics (Option B from part_2.md).

The stemmer runs on EVERY user utterance before the LLM call (rule-based,
zero tokens). When it detects a real error - e.g. a tense marker that clashes
with a time cue word - we inject a compact structured diagnostic into the
prompt. For correct sentences we inject nothing, so those turns stay cheap.

This (not vector retrieval) is what feeds LlamaIndex's "context slot": the
knowledge here is linguistic structure, not a document corpus.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.stemmer.swahili import analyze_swahili_word
from app.models.schemas import StemAnalysis

# Time cue word -> tense marker that grammatically agrees with it.
#
# Only UNambiguous cues qualify. "leo" (today) is intentionally excluded: it
# is valid with past, present AND future tenses ("Nilikula leo", "Ninakula
# leo", "Nitakula leo" are all correct), so flagging on it would produce false
# positives on correct sentences.
TIME_CUES: dict[str, str] = {
    "jana": "li",        # yesterday -> past
    "zamani": "li",      # long ago -> past
    "kesho": "ta",       # tomorrow -> future
    "usiku": "li",       # (that) night -> past
}

# Tense markers we can reason about deterministically, keyed by symbol.
_TENSE_TOKENS = {
    "li": "li",
    "me": "me",
    "na": "na",
    "ta": "ta",
    "ka": "ka",
    "nge": "nge",
    "ngali": "ngali",
    "ja": "ja",
}

_PUNCT = set(" .?!,;:\"'()[]{}-\u2018\u2019\u201c\u201d\u2014")


@dataclass
class StemDiagnostic:
    root: str = ""
    given_marker: str | None = None
    expected_marker: str | None = None
    cue: str | None = None
    has_error: bool = False
    error_type: str | None = None

    def compact(self) -> dict:
        """The compact structured object injected into the prompt (no prose)."""
        return {
            "root": self.root,
            "given_marker": self.given_marker,
            "expected_marker": self.expected_marker,
            "cue": self.cue,
            "error_type": self.error_type,
        }

    def __bool__(self) -> bool:
        return self.has_error


@dataclass
class _WordLook:
    word: str
    stem: StemAnalysis
    marker: str | None


def analyze_sentence(sentence: str) -> StemDiagnostic:
    """Inspect a learner utterance for a tense-marker/time-cue mismatch.

    Pure and deterministic - no LLM involvement. For each word we read the
    morphological segment out of :func:`analyze_swahili_word`, then compare the
    verb's tense marker against what the sentence's time cue word requires.
    """
    if not sentence or not sentence.strip():
        return StemDiagnostic()

    tokens = [w.strip("".join(_PUNCT)).lower() for w in sentence.split()]
    tokens = [t for t in tokens if t]

    cue_token, expected_marker = _find_cue(tokens)
    if cue_token is None:
        return StemDiagnostic()

    for w in tokens:
        look = _analysis(w)
        if look is None or look.marker is None:
            continue
        if look.marker != expected_marker:
            return StemDiagnostic(
                root=look.stem.lemma or look.stem.breakdown,
                given_marker=look.marker,
                expected_marker=expected_marker,
                cue=cue_token,
                has_error=True,
                error_type="tense_marker",
            )
    return StemDiagnostic()


def _find_cue(tokens: list[str]) -> tuple[str | None, str | None]:
    for token in tokens:
        if token in TIME_CUES:
            return token, TIME_CUES[token]
    return None, None


def _analysis(word: str) -> _WordLook | None:
    stem = analyze_swahili_word(word)
    if not stem.is_swahili:
        return None
    marker = None
    for seg in stem.segments:
        symbol = seg.segment
        if seg.kind == "tense" and symbol in _TENSE_TOKENS:
            marker = symbol
            break
    if marker is None:
        return None
    return _WordLook(word=word, stem=stem, marker=marker)