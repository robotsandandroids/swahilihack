# Swahili morphological segmenter

Goals (from the product brief): for any word a learner hears or says, show a
`ku-li-a`-style grapheme breakdown **and** a dictionary-style lemma, so
patterns like tenses map onto English "-ing"/"past" intuition.

## Why not just Snowball

`snowballstemmer` ships suffix-strippers for European languages — there is
no Swahili algorithm, and suffix stripping would corrupt Swahili's
prefix-heavy structure ("kula" carries its "to" as a prefix, not a suffix).

Instead: a compact, rule-based surface segmenter
(`backend/app/services/stemmer/swahili.py`) with **no external deps**.

## What it recognizes

```
verbs:   [INF ku-/kw-] [NEG si-/hu-/ha-/...] [SC] [TAM] [OC] STEM + FINAL_VOWEL
nouns:   common noun-class prefixes (m-, ki-, vi-, n-, ji-, ma-, u- ...)
```

Examples:

| word | breakdown | lemma | notes |
| --- | --- | --- | --- |
| `kulia` | `ku-li-a` | `kulia` | infinitive + stem `li` + final `-a` |
| `alilia` | `a-li-li-a` | `lia` | SC `a-`, past `-li-`, stem `li`, final `-a` |
| `ninakula` | `ni-na-ku-la` | `kula` | 1sg present continuous + embedded infinitive |
| `tutasoma` | `tu-ta-som-a` | `soma` | 1pl future |
| `sijui` | `si-ju-i` | `jua` | negative present + negative final `-i` |
| `kitabu` | `ki-tabu` | `kitabu` | noun class 7 |

TC tuple tables are in `swahili.py`: `SUBJECT_PREFIXES`, `TAM`
(na/li/me/ta/ka/nge/ngali/ja), `OBJECT_INFIXES`, `NEGATIVE_PRESENT`,
`NOUN_PREFIXES`.

## Heuristics & guardrails

Segmentation is surface-morphological, not a full Bantu parse, so the code
defends against the classic failures:

- **Noun/verb false positives** — a subject concord is only accepted when a
  tense marker, object infix or known verb stem follows. This keeps
  `kitabu` → `ki-tabu` and stops `vitabu` from being misread as `vi` +
  future-tense verb.
- **Lesson ambiguity** — `habari` (news, no class prefix), `mama`,
  `nyanya` are neither split nor claimed to be Swahili morphology:
  single-root nouns return low-confidence `noun_stem` entries or
  `is_swahili: false`.
- **Final-vowel logic** — split only on 3+ character residues, so `kula`
  stays `ku-la`, not `ku-l-a`.

Every result carries `confidence` (e.g. tense-detected verbs 0.9, noun class
guesses 0.55, single roots 0.3) and the client always shows the raw word
above the breakdown.

## Known limitations (documented, future work)

- Only canonical present/past/perfect/future + a few others; no relative
  infixes or applicative/causative extensions (`-lia`, `-ishia`).
- Object infixes need `>=3` leftover chars, so some short forms stay unsplit.
- Lemma reconstruction flips `-e`→`-a` and re-adds `ku-`, but derivational
  suffixes aren't decomposed.
- No dictionary/lexicon yet: correctness relies on the heuristics.
  A small hand-curated frequency list (common nouns + verbs) would raise
  precision a lot.

Verified by `backend/tests/test_stemmer.py` (run `uv run pytest`).