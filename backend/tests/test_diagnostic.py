from __future__ import annotations

from app.services.memory import ErrorCache, SummarizingMemory
from app.services.stemmer.diagnostic import analyze_sentence
from app.services.llm import render_user_content
from llama_index.core.llms import ChatMessage, MessageRole


## analia =  a-li-li-a
## kukula = ku-kula
## aliwaye = a-li-wa-ye

## morpheme. - smallest unit of meaning in a language.
# noun - mama
# # adverb - kule

def test_mismatched_tense_with_cue_is_caught():
    diag = analyze_sentence("atalia jana")
    assert diag.has_error
    assert diag.root == "lia"
    assert diag.given_marker == "ta"
    assert diag.expected_marker == "li"
    assert diag.cue == "jana"
    assert diag.error_type == "tense_marker"


def test_correct_tense_with_cue_passes():
    assert not analyze_sentence("nilikula jana").has_error
    assert not analyze_sentence("nitakula kesho").has_error


def test_mismatch_in_other_direction_is_caught():
    diag = analyze_sentence("Nilikwenda sokoni kesho")
    assert diag.has_error
    assert diag.given_marker == "li"
    assert diag.expected_marker == "ta"


def test_clean_sentence_has_no_error():
    for s in ("Habari, unakuwaje?", "", "Nyanya ngapi?", "Ninapenda kahawa"):
        diag = analyze_sentence(s)
        assert not diag.has_error, s


def test_compact_output_is_minimal():
    diag = analyze_sentence("atalia jana")
    compact = diag.compact()
    assert set(compact) == {"root", "given_marker", "expected_marker", "cue", "error_type"}


def test_render_user_content_injects_only_on_error():
    ok = render_user_content("Ninapenda kahawa", None)
    assert "diagnostic" not in ok

    diag = analyze_sentence("atalia jana")
    injected = render_user_content("atalia jana", diag, is_repeat=False)
    assert "[diagnostic:" in injected
    assert "repeat_error=false" in injected

    repeated = render_user_content("atalia jana", diag, is_repeat=True)
    assert "repeat_error=true" in repeated


def test_error_cache_repeat_detection():
    cache = ErrorCache()
    assert cache.check_and_record("tense_marker", "lia") is False
    assert cache.check_and_record("tense_marker", "lia") is True
    assert cache.check_and_record("noun_class_agreement", "kiti") is False
    assert len(cache.counts()) == 2


class _FakeSummarizer:
    def complete(self, prompt: str, max_tokens: int = 120) -> str:
        return "Learner struggled with li vs ta; covered market vocabulary."


def test_memory_roundtrip_from_history():
    llm = _FakeSummarizer()
    history = [
        {"role": "assistant", "content": "Karibu! Unataka nyanya ngapi?"},
        {"role": "user", "content": "Nataka nyanya."},
    ]
    memory = SummarizingMemory.from_history(llm, history)
    assert memory.turn_count == 1
    snapshot = memory.to_history()
    assert len(snapshot) == 2
    assert snapshot[0]["role"] == "assistant"

    rebuilt = SummarizingMemory.from_history(llm, snapshot)
    assert rebuilt.turn_count == 1
    assert rebuilt.to_history() == snapshot


def test_memory_put_and_get():
    llm = _FakeSummarizer()
    memory = SummarizingMemory(llm, token_limit=100, summarize_every=100)
    memory.put(ChatMessage(role=MessageRole.USER, content="test"))
    msgs = memory.get()
    assert msgs[-1].content == "test"
    assert memory.turn_count == 1
