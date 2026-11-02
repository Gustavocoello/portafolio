# Correr desde backend/:  python -m pytest tests
from types import SimpleNamespace

import pytest

from src.services.llm.chat import llm_router


class FakeOpenAI:
    """Cliente falso: el proveedor 'down' siempre falla."""
    calls = []

    def __init__(self, base_url, api_key):
        self.api_key = api_key
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages):
        FakeOpenAI.calls.append(self.api_key)
        if self.api_key == "down":
            raise ConnectionError("rate limited")
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=f" from {self.api_key} "))])


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
