from unittest.mock import MagicMock, patch

import pytest
from llama_index.core.llms import ChatMessage, MessageRole

from app.core.config import Settings
from app.services.llm import LLMService, _parse_llm_json


def test_parse_llm_json_direct():
    raw = '{"ai_text": "Jambo", "ai_translation": "Hello", "feedback": {"score": 90}}'
    parsed = _parse_llm_json(raw)
    assert parsed["ai_text"] == "Jambo"
    assert parsed["feedback"]["score"] == 90


def test_parse_llm_json_markdown_code_fence():
    raw = """```json
{
  "ai_text": "Habari!",
  "ai_translation": "Greetings!",
  "feedback": {"score": 85}
}
```"""
    parsed = _parse_llm_json(raw)
    assert parsed["ai_text"] == "Habari!"
    assert parsed["ai_translation"] == "Greetings!"
    assert parsed["feedback"]["score"] == 85


def test_parse_llm_json_with_surrounding_prose():
    raw = """Here is the response:
```json
{
  "ai_text": "Karibu!",
  "ai_translation": "Welcome!"
}
```
Let me know if you need more."""
    parsed = _parse_llm_json(raw)
    assert parsed["ai_text"] == "Karibu!"
    assert parsed["ai_translation"] == "Welcome!"


def test_provider_chain_gemini_primary_mistral_fallback():
    settings = Settings(
        llm_provider="gemini",
        gemini_api_key="fake-gemini-key",
        mistral_api_key="fake-mistral-key",
    )
    with patch("app.services.llm.get_settings", return_value=settings):
        svc = LLMService()
        chain = svc._provider_chain()
        names = [n for n, _, _ in chain]
        assert names == ["gemini", "mistral"]


def test_provider_chain_mistral_primary_gemini_fallback():
    settings = Settings(
        llm_provider="mistral",
        gemini_api_key="fake-gemini-key",
        mistral_api_key="fake-mistral-key",
    )
    with patch("app.services.llm.get_settings", return_value=settings):
        svc = LLMService()
        chain = svc._provider_chain()
        names = [n for n, _, _ in chain]
        assert names == ["mistral", "gemini"]


def test_chat_fallover_to_mistral():
    settings = Settings(
        llm_provider="gemini",
        gemini_api_key="fake-gemini-key",
        mistral_api_key="fake-mistral-key",
    )
    with patch("app.services.llm.get_settings", return_value=settings):
        svc = LLMService()

        # Mock Gemini call to fail, and Mistral call to succeed
        svc._chat_gemini_once = MagicMock(side_effect=RuntimeError("Gemini 429 quota"))
        svc._chat_mistral_once = MagicMock(return_value='{"ai_text": "Hujambo kutoka Mistral"}')

        messages = [ChatMessage(role=MessageRole.USER, content="Habari")]
        result = svc.chat(messages)

        svc._chat_gemini_once.assert_called_once()
        svc._chat_mistral_once.assert_called_once()
        assert result == '{"ai_text": "Hujambo kutoka Mistral"}'
