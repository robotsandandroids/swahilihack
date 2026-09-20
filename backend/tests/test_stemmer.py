from __future__ import annotations

from app.services.stemmer.swahili import analyze_swahili_word

CASES = [
    # (word, expected_breakdown, expected_lemma)
    ("kulia", "ku-li-a", "kulia"),
    ("alilia", "a-li-li-a", "lia"),
    ("ninakula", "ni-na-ku-la", "kula"),
    ("alikula", "a-li-ku-la", "kula"),
    ("nimekula", "ni-me-ku-la", "kula"),
    ("nitakula", "ni-ta-ku-la", "kula"),
    ("tutasoma", "tu-ta-som-a", "soma"),
    ("nasema", "na-sem-a", "sema"),
    ("walisoma", "wa-li-som-a", "soma"),
    ("unaweza", "u-na-wez-a", "weza"),
    ("nikupenda", "ni-ku-pend-a", "penda"),
    ("sikipenda", "si-ki-pend-a", "penda"),
    ("kwenda", "kw-end-a", "kwenda"),
    ("sijui", "si-ju-i", "jua"),
    ("kitabu", "ki-tabu", "kitabu"),
    ("vitabu", "vi-tabu", "vitabu"),
    ("kijana", "ki-jana", "kijana"),
    ("mtoto", "m-toto", "mtoto"),
    ("ngapi", "n-gapi", "ngapi"),
]


def test_breakdowns() -> None:
    for word, expected, lemma in CASES:
        result = analyze_swahili_word(word)
        assert result.breakdown == expected, (
            f"{word}: expected '{expected}', got '{result.breakdown}'"
        )
        assert result.is_swahili, f"{word}: expected is_swahili=True"


def test_lemmas() -> None:
    for word, _, lemma in CASES:
        result = analyze_swahili_word(word)
        assert result.lemma == lemma, (
            f"{word}: expected lemma '{lemma}', got '{result.lemma}'"
        )


def test_single_roots_are_not_hijacked() -> None:
    for word in ("mama", "baba", "nyanya", "mbwa", "maji"):
        result = analyze_swahili_word(word)
        assert not result.breakdown.endswith("-"), f"{word} unexpectedly split early"


def test_unknown_words() -> None:
    result = analyze_swahili_word("habari")
    assert result.is_swahili is False