# Correr desde backend/:  python -m pytest tests
from types import SimpleNamespace

import pytest
import requests

from src.services.agent.jarvis.tools import panel


class Respuesta:
    def __init__(self, status: int, datos):
        self.status_code, self._datos, self.text = status, datos, str(datos)

    def json(self):
        return self._datos


@pytest.fixture
def llamadas(monkeypatch):
    monkeypatch.setenv("PANEL_URL", "https://panel-api.ejemplo/")
    monkeypatch.setenv("PANEL_TARS_TOKEN", "bic_llave")
    panel._ultimo_uso.clear()
    hechas, respuestas = [], []

    def falso(metodo, url, params=None, timeout=None, headers=None):
        hechas.append(SimpleNamespace(metodo=metodo, url=url, params=params, headers=headers))
        r = respuestas.pop(0) if respuestas else Respuesta(200, {"ok": True})
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(panel.requests, "request", falso)
    return SimpleNamespace(hechas=hechas, respuestas=respuestas)


def _herramientas():
    return {t.name: t for t in panel.build_panel_tools("u1")}


def test_solo_consulta_y_alertas_o_errores():
    # Nada de rotar tokens, cambiar keys ni pausar fuentes
    assert set(_herramientas()) == {"panel_estado", "panel_alertas", "panel_errores", "panel_respaldos",
                                    "panel_llm_router", "panel_reconocer_alerta", "panel_resolver_alerta",
                                    "panel_resolver_error"}


def test_usa_su_llave_y_la_ruta_de_tars(llamadas):
    h = _herramientas()
    llamadas.respuestas.append(Respuesta(200, {"alertas_activas": 0, "con_problemas": []}))
    assert '"alertas_activas": 0' in h["panel_estado"].invoke({})
    c = llamadas.hechas[0]
    assert (c.metodo, c.url) == ("GET", "https://panel-api.ejemplo/api/tars/estado")
    assert c.headers == {"X-Tars-Token": "bic_llave"}

    h["panel_alertas"].invoke({"historial": True})
    assert llamadas.hechas[1].params == {"estado": "historial"}
    h["panel_resolver_alerta"].invoke({"alerta_id": 7})
    assert (llamadas.hechas[2].metodo, llamadas.hechas[2].url) == ("POST", "https://panel-api.ejemplo/api/tars/alertas/7/resolver")


def test_firma_invalida_no_llega_al_panel(llamadas):
    r = _herramientas()["panel_resolver_error"].invoke({"firma": "../fuentes/mvm/rotar-token"})
    assert r.startswith("Error") and not llamadas.hechas
    _herramientas()["panel_resolver_error"].invoke({"firma": " ABABABABABAB "})
    assert llamadas.hechas[0].url.endswith("/api/tars/errores/abababababab/resolver")


def test_errores_del_panel_se_dicen_tal_cual(llamadas):
    llamadas.respuestas += [Respuesta(404, {"detail": "Alerta no encontrada"}),
                            requests.ConnectionError("sin red")]
    h = _herramientas()
    assert h["panel_reconocer_alerta"].invoke({"alerta_id": 9}) == "Error 404 del panel: Alerta no encontrada"
    assert "el panel no responde" in h["panel_estado"].invoke({})


def test_se_carga_solo_cuando_hace_falta(llamadas):
    assert panel.panel_disponible()
    assert not panel.necesita_panel("¿qué tengo hoy en la agenda?", "u2")
    for frase in ["¿Cómo está el panel?", "¿hay alertas?", "¿algún servidor caído?", "¿cómo va el router?",
                  "¿se hizo el respaldo de MVM?", "¿Cuántos tokens gasté hoy?", "errores de Previseguros"]:
        assert panel.necesita_panel(frase, "u2"), frase
    _herramientas()["panel_estado"].invoke({})  # usada hace poco: "¿y la otra?" sigue con el panel
    assert panel.necesita_panel("¿y la otra?", "u1")


def test_sin_llave_no_se_carga(monkeypatch):
    monkeypatch.delenv("PANEL_TARS_TOKEN", raising=False)
    monkeypatch.setenv("PANEL_URL", "https://panel-api.ejemplo")
    assert not panel.panel_disponible()
