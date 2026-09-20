"""Rule-based Swahili morphological segmenter.

Snowball's ``snowballstemmer`` package has no Swahili algorithm (it covers
European languages), so instead of a plain suffix-stripping stemmer we
implement a lightweight surface-segmenter for the two patterns that matter
most for language learners:

  verbs:   [INF ku-] [NEG] [SC] [TAM] [OBJ] STEM + FINAL_VOWEL
           e.g. ``ninakula`` -> ni-na-ku-la, ``alilia`` -> a-li-li-a
  nominals: common noun-class prefixes
           e.g. ``vitabu`` -> vi-tabu, ``mganga`` -> m-ganga

Segmentation is **surface-level heuristics**, not a full typological parse:
a handful of Swahili nouns (e.g. ``mama``, ``nyanya``) look like a prefix +
stem but are lexically single roots, so results carry a ``confidence`` score
and the UI always shows the raw word alongside the breakdown.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.schemas import StemAnalysis, StemSegment

# --- Subject concords (SC) -------------------------------------------------
SUBJECT_PREFIXES: dict[str, str] = {
    "ni": "1sg subject (I)",
    "u": "2sg subject (you)",
    "a": "3sg subject (he/she)",
    "tu": "1pl subject (we)",
    "m": "2pl subject (you all)",
    "wa": "3pl subject (they)",
    "li": "cl5 subject (it)",
    "ya": "cl6 subject (they)",
    "ki": "cl7 subject (it)",
    "vi": "cl8 subject (they)",
    "i": "cl9 subject (it)",
    "zi": "cl10 subject (they)",
    "pa": "cl16 locative subject",
    "ku": "cl17 infinitive/locative",
    "ji": "reflexive (self)",
}

# Negative present-tense agreement markers (fused NEG+SC).
NEGATIVE_PRESENT: list[tuple[str, str]] = [
    ("hawa", "neg 3pl present (they don't)"),
    ("hatu", "neg 1pl present (we don't)"),
    ("ham", "neg 2pl present (you all don't)"),
    ("hu", "neg 2sg present (you don't)"),
    ("ha", "neg 3sg present (he/she doesn't)"),
    ("si", "neg 1sg present (I don't)"),
]

# --- Tense / aspect markers (TAM) ------------------------------------------
TAM: list[tuple[str, str]] = [
    ("ngali", "conditional past (would have)"),
    ("nge", "conditional (would)"),
    ("me", "perfect (have/has -ed)"),
    ("na", "present continuous (is -ing)"),
    ("li", "past (-ed)"),
    ("ta", "future (will)"),
    ("ka", "consecutive (and then)"),
    ("ja", "not yet (haven't)"),
]

# --- Object infixes (OC) ----------------------------------------------------
OBJECT_INFIXES: dict[str, str] = {
    "ni": "object: me",
    "ku": "object: you",
    "m": "object: him/her",
    "mu": "object: him/her",
    "wa": "object: them",
    "li": "object: it (cl5)",
    "ya": "object: them (cl6)",
    "ki": "object: it (cl7)",
    "vi": "object: them (cl8)",
    "i": "object: it (cl9)",
    "zi": "object: them (cl10)",
    "tu": "object: us",
}

# --- Noun class prefixes ----------------------------------------------------
NOUN_PREFIXES: list[tuple[str, str]] = [
    ("mw", "cl1 noun (person/animal)"),
    ("m", "cl1/3 noun (person/tree)"),
    ("wa", "cl2 noun (people)"),
    ("mi", "cl4 noun (trees)"),
    ("ki", "cl7 noun (thing)"),
    ("ch", "cl7 noun before a/e/i (thing)"),
    ("vi", "cl8 noun (plural things)"),
    ("vy", "cl8 noun before a/e/i (things)"),
    ("n", "cl9/10 noun (animals/things)"),
    ("ny", "cl9/10 nasal noun"),
    ("ji", "cl5 noun (big thing)"),
    ("j", "cl5 noun before vowel"),
    ("ma", "cl6 noun (plural)"),
    ("u", "cl11 noun (abstract)"),
    ("pa", "cl16 locative (at)"),
    ("ku", "cl17 locative (to/from)"),
    ("mu", "cl18 locative (inside)"),
]

# Words that carry a prefix-like shape but are lexically single roots.
_NOUN_TROUBLE = {
    "mama", "baba", "nyanya", "mbwa", "ndizi", "maji", "nyumba", "nyama",
    "shamba", "paka", "mwezi", "moto", "saa", "samaki",
}

# Known verb-stem tips used to decide when a prefix really precedes a verb.
_VERB_STEM_TIPS = {
    "la", "li", "ja", "ju", "wez", "som", "end", "pend", "tak", "on",
    "nunu", "uliz", "sem", "chez", "imb", "kia", "lal", "amk", "ogop",
    "jibu", "fika", "nia", "sikiliz", "jembe", "gaw", "punguz",
}

_FINAL_VOWELS = {"a", "e", "i", "o", "u"}


@dataclass
class _Parsed:
    segments: list[StemSegment]
    confidence: float


def analyze_swahili_word(word: str) -> StemAnalysis:
    """Return a morpheme breakdown for a single word (e.g. ``a-li-li-a``)."""
    word = _norm(word)
    if not word:
        return _empty(word)

    parsed, _ = _parse_verb(word)
    if parsed is None:
        parsed = _parse_noun(word)

    if parsed is None:
        return StemAnalysis(
            word=word,
            breakdown=word,
            segments=[StemSegment(segment=word, kind="unknown", gloss="unrecognized word")],
            is_swahili=False,
            confidence=0.0,
        )

    breakdown = "-".join(s.segment for s in parsed.segments)
    return StemAnalysis(
        word=word,
        breakdown=breakdown,
        segments=parsed.segments,
        lemma=_lemma_for(parsed, word),
        is_swahili=True,
        confidence=parsed.confidence,
    )


def _empty(word: str) -> StemAnalysis:
    return StemAnalysis(word=word, breakdown="", lemma="")


def _parse_verb(word: str) -> tuple[_Parsed | None, str]:
    if word in _NOUN_TROUBLE:
        return None, "lexical root; not a verb"

    segments: list[StemSegment] = []
    rest = word

    # 1) Infinitive ku-/kw-
    if rest.startswith("kw") and not rest.startswith("kwa"):
        segments.append(StemSegment(segment="kw", kind="infinitive", gloss="to (ku- before vowels)"))
        rest = rest[2:]
    elif rest.startswith("ku"):
        segments.append(StemSegment(segment="ku", kind="infinitive", gloss="to (infinitive)"))
        rest = rest[2:]

    # 2) Negative present (fused NEG+SC), only when a verb clearly follows.
    for neg, gloss in NEGATIVE_PRESENT:
        if rest.startswith(neg) and _tail_looks_verbal(rest[len(neg):]):
            segments.append(StemSegment(segment=neg, kind="negation", gloss=gloss))
            rest = rest[len(neg):]
            break

    # 3) Subject concord.
    for sc, gloss in _sorted_longest(SUBJECT_PREFIXES):
        if rest.startswith(sc) and _rest_eligible(rest, sc):
            segments.append(StemSegment(segment=sc, kind="subject", gloss=gloss))
            rest = rest[len(sc):]
            break

    # 4) Tense / aspect marker.
    for tam, gloss in TAM:
        after = rest[len(tam):] if rest.startswith(tam) else ""
        if rest.startswith(tam) and len(after) >= 3:
            segments.append(StemSegment(segment=tam, kind="tense", gloss=gloss))
            rest = after
            break

    # 5) Object infix (only with prior inflection; needs >=3 chars left over).
    if any(s.kind in ("subject", "tense", "negation") for s in segments):
        for oc, gloss in _sorted_longest(OBJECT_INFIXES):
            if rest.startswith(oc) and len(rest) > len(oc) + 2:
                segments.append(StemSegment(segment=oc, kind="object", gloss=gloss))
                rest = rest[len(oc):]
                break

    if not segments:
        return None, "no verbal morphology found"

    # 6a) Reject nominal false positives: SC without any real tense/object
    #     leaves a residue that is not a clear verb stem.
    kinds = {s.kind for s in segments}
    if "tense" not in kinds and "negation" not in kinds and "object" not in kinds:
        if "subject" in kinds and len(rest) >= 2:
            if not any(tip and rest.startswith(tip) and len(tip) >= 3 for tip in _VERB_STEM_TIPS):
                return None, "nominal false positive"

    # 6) Embedded infinitive ku- within a conjugated verb: ni-na-ku-la.
    if (
        not any(s.kind == "infinitive" for s in segments)
        and rest.startswith("ku")
        and any(tip + "a" in (rest[2:], rest[2:] + "a") or rest[2:].startswith(tip) for tip in _VERB_STEM_TIPS if len(tip) >= 2)
        and len(rest) > 2
    ):
        segments.append(StemSegment(segment="ku", kind="infinitive", gloss="embedded infinitive ku- (e.g. kula, kwenda)"))
        rest = rest[2:]

    # 7) Verb stem + final vowel.
    if rest:
        fv = rest[-1] if len(rest) >= 3 and rest[-1] in _FINAL_VOWELS else None
        stem = rest[:-1] if fv else rest
        if stem:
            segments.append(StemSegment(segment=stem, kind="verb_stem", gloss="verb root"))
        if fv:
            segments.append(StemSegment(segment=fv, kind="final_vowel", gloss="final vowel (a/e/i)"))

    confidence = 0.9 if any(s.kind == "tense" for s in segments) else 0.75
    return _Parsed(segments, confidence), "verb"


def _parse_noun(word: str) -> _Parsed | None:
    if word in _NOUN_TROUBLE:
        segments = [
            StemSegment(segment=word, kind="noun_stem", gloss="single-root noun (no class split)"),
        ]
        return _Parsed(segments, 0.3)

    for prefix, gloss in _sorted_longest(NOUN_PREFIXES):
        if word.startswith(prefix) and len(word) > len(prefix):
            stem_part = word[len(prefix):]
            segments = [
                StemSegment(segment=prefix, kind="nominal", gloss=gloss),
                StemSegment(segment=stem_part, kind="noun_stem", gloss="noun root"),
            ]
            return _Parsed(segments, 0.55)
    return None


# --- helpers ---------------------------------------------------------------
def _norm(word: str) -> str:
    return word.strip(" .?!,;:\"'()[]{}-").lower()


def _sorted_longest(mapping: dict[str, str] | list[tuple[str, str]]) -> list[tuple[str, str]]:
    if isinstance(mapping, dict):
        items = list(mapping.items())
    else:
        items = list(mapping)
    return sorted(items, key=lambda kv: -len(kv[0]))


def _tail_looks_verbal(tail: str) -> bool:
    if not tail or not tail[0].isalpha():
        return False
    if any(tail.startswith(sc) for sc in SUBJECT_PREFIXES):
        return True
    if any(tail.startswith(tam) for tam, _ in TAM):
        return True
    return any(tip and tail.startswith(tip) and len(tip) >= 2 for tip in _VERB_STEM_TIPS)


def _rest_eligible(rest: str, sc: str) -> bool:
    """A subject concord only counts when a TAM or a plausible stem follows."""
    tail = rest[len(sc):]
    if not tail:
        return False
    if any(tail.startswith(tam) and len(tail) > len(tam) + 2 for tam, _ in TAM):
        return True
    if any(
        tail.startswith(oc)
        and len(tail) > len(oc) + 1
        and any(tip and tail[len(oc):].startswith(tip) for tip in _VERB_STEM_TIPS)
        for oc in OBJECT_INFIXES
    ):
        return True
    return any(tip and tail.startswith(tip) and len(tip) >= 2 for tip in _VERB_STEM_TIPS)


def _lemma_for(parsed: _Parsed, word: str) -> str:
    inf = next((s for s in parsed.segments if s.kind == "infinitive"), None)
    stem = next((s for s in parsed.segments if s.kind == "verb_stem"), None)
    if stem is None:
        return word
    base = stem.segment
    if not base.endswith("a"):
        base += "a"
    return f"{inf.segment}{base}" if inf else base


# --- public helpers ----------------------------------------------------------
def breakdown_batch(words: list[str]) -> list[StemAnalysis]:
    seen: dict[str, StemAnalysis] = {}
    for w in words:
        if w.isalpha():
            w = w.lower()
            if w not in seen:
                seen[w] = analyze_swahili_word(w)
    return list(seen.values())