# Correr desde backend/:  python -m pytest tests
from types import SimpleNamespace

import pytest

from src.services.llm.chat import llm_router


class FakeOpenAI:
    """Cliente falso: el proveedor 'down' siempre falla, 'flaky' corta el stream a la mitad."""
    calls = []

    def __init__(self, base_url, api_key):
        self.api_key = api_key
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages, stream=False):
        FakeOpenAI.calls.append(self.api_key)
        if self.api_key == "down":
            raise ConnectionError("rate limited")
        if stream:
            return self._stream()
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=f" from {self.api_key} "))])

    def _stream(self):
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="hola "))])
        if self.api_key == "flaky":
            raise ConnectionError("stream cortado")
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="mundo"))])


@pytest.fixture
def providers(monkeypatch):
    def use(*keys):
        monkeypatch.setattr(llm_router, "OpenAI", FakeOpenAI)
        monkeypatch.setattr(llm_router, "API_PROVIDERS_TO_AGENT", [
            {"name": k, "base_url": "https://x", "key": f"KEY_{i}", "model": "m"} for i, k in enumerate(keys)
        ])
        for i, k in enumerate(keys):
            monkeypatch.setenv(f"KEY_{i}", k)
        FakeOpenAI.calls = []
    return use


def test_falls_back_and_recovers_on_next_call(providers):
    providers("down", "ok")
    assert llm_router.completion([]) == "from ok"

    # Si todos fallan una vez, la app no debe quedar muerta para siempre
    providers("down")
    with pytest.raises(RuntimeError):
        llm_router.completion([])
    providers("ok")
    assert llm_router.completion([]) == "from ok"


def test_stream_does_not_repeat_text_after_partial_failure(providers):
    providers("flaky", "ok")
    out = []
    with pytest.raises(ConnectionError):
        for chunk in llm_router.completion_stream([]):
            out.append(chunk)
    assert out == ["hola "]
    assert FakeOpenAI.calls == ["flaky"]


def test_stream_falls_back_before_any_text(providers):
    providers("down", "ok")
    assert "".join(llm_router.completion_stream([])) == "hola mundo"
