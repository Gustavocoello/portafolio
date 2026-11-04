"""Panel BrokerIA (BROKER·IA Control, repo brokeria-panel): estado de servidores y brokers, alertas, errores,
respaldos y llm-router.

Entra con su propia llave (PANEL_TARS_TOKEN, cabecera X-Tars-Token) a /api/tars del panel, que solo deja consultar
y reconocer o resolver alertas y errores. Rotar tokens, editar keys o pausar fuentes no existen aquí ni en esa ruta.
"""
import json
import os
import re
import time
import unicodedata

import requests
from langchain_core.tools import tool

from src.core.logging import get_logger

logger = get_logger("panel")

ESPERA = 15          # s
VIGENCIA_USO = 600   # s en que las herramientas siguen cargadas después de usarlas ("resuélvela", "¿y la otra?")

_ultimo_uso: dict[str, float] = {}

# Palabras que cargan estas herramientas (el resto de preguntas no paga sus tokens)
_PALABRAS = re.compile(
    r"\b(panel|brokeria|broker ?ia|brokers?|alertas?|errore?s?|respaldos?|backups?|servidor\w*|servicios?|"
    r"caid[oa]s?|en linea|router|llm|keys?|llaves?|cuotas?|tokens?|mvm|previseguros|apse|oracle|"
    r"home ?lab|tuneles?|infraestructura)\b"
)


def _normal(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.casefold()) if unicodedata.category(c) != "Mn")


def panel_disponible() -> bool:
    return bool(os.getenv("PANEL_URL") and os.getenv("PANEL_TARS_TOKEN"))


def necesita_panel(texto: str, user_id: str) -> bool:
    """¿Este mensaje usa el panel? Por palabras o porque lo usó hace poco."""
    if time.time() - _ultimo_uso.get(user_id, 0) < VIGENCIA_USO:
        return True
    return bool(_PALABRAS.search(_normal(texto)))


def _llamar(user_id: str, metodo: str, ruta: str, params: dict | None = None) -> str:
    _ultimo_uso[user_id] = time.time()
    url = os.getenv("PANEL_URL", "").rstrip("/") + "/api/tars" + ruta
    try:
        r = requests.request(metodo, url, params=params, timeout=ESPERA,
                             headers={"X-Tars-Token": os.getenv("PANEL_TARS_TOKEN", "")})
    except requests.RequestException as e:
        logger.error(f"[PANEL] {metodo} {ruta}: {e!r}")
        return f"Error: el panel no responde. No inventes el estado; dile a Gustavo que no llegaste al panel. ({e!r})"
    if r.status_code >= 400:
        try:
            detalle = r.json().get("detail")
        except ValueError:
            detalle = r.text[:200]
        logger.error(f"[PANEL] {metodo} {ruta}: {r.status_code} {detalle}")
        return f"Error {r.status_code} del panel: {detalle}"
    return json.dumps(r.json(), ensure_ascii=False, default=str)


def build_panel_tools(user_id: str) -> list:
    @tool
    def panel_estado() -> str:
        """Estado general del panel BrokerIA (servidores, brokers MVM y Previseguros, apps, llm-router): cuántos
        están en línea, alertas y errores activos, respaldos con problema, tokens del LLM de hoy, y solo lo que no
        está en verde. Úsala para "¿cómo está todo?", "¿algo caído?" o "¿cómo están los servidores?". Si todo
        está bien, dilo en una frase."""
        return _llamar(user_id, "GET", "/estado")

    @tool
    def panel_alertas(historial: bool = False) -> str:
        """Alertas del panel BrokerIA con su id, fuente, severidad (critica/advertencia), estado (abierta o
        reconocida) y mensaje. historial=True da las últimas 10 resueltas. Nunca digas el id en voz alta."""
        return _llamar(user_id, "GET", "/alertas", {"estado": "historial" if historial else "activas"})

    @tool
    def panel_errores() -> str:
        """Errores sin resolver que reportan los brokers, agrupados (firma, tipo, mensaje, cuántas veces, en qué
        broker y cuándo). Nunca leas la firma en voz alta."""
        return _llamar(user_id, "GET", "/errores")

    @tool
    def panel_respaldos() -> str:
        """Último respaldo de cada servidor y app (ok, atrasado, error o sin_respaldo), con fecha y tamaño."""
        return _llamar(user_id, "GET", "/respaldos")

    @tool
    def panel_llm_router() -> str:
        """Estado del llm-router (el que da los LLM a los brokers y a TARS): si está en línea, keys con problemas,
        cuota gratis de hoy (usada y disponible), tokens y gasto de pago de hoy, y los clientes."""
        return _llamar(user_id, "GET", "/llm")

    @tool
    def panel_reconocer_alerta(alerta_id: int) -> str:
        """Marca una alerta como reconocida (Gustavo ya la vio; sigue activa y deja de insistir). Úsala solo si
        Gustavo lo pide; toma el id de panel_alertas, nunca lo adivines."""
        return _llamar(user_id, "POST", f"/alertas/{int(alerta_id)}/reconocer")

    @tool
    def panel_resolver_alerta(alerta_id: int) -> str:
        """Cierra una alerta. Úsala solo si Gustavo lo pide; toma el id de panel_alertas. Si el problema sigue,
        el panel la vuelve a abrir en un minuto: díselo."""
        return _llamar(user_id, "POST", f"/alertas/{int(alerta_id)}/resolver")

    @tool
    def panel_resolver_error(firma: str) -> str:
        """Marca un error de los brokers como resuelto (deja de salir en la lista). Úsala solo si Gustavo lo pide;
        'firma' es la de panel_errores, tal cual."""
        firma = firma.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{8,64}", firma):
            return "Error: esa no es una firma de panel_errores. Llama panel_errores y usa la firma tal cual."
        return _llamar(user_id, "POST", f"/errores/{firma}/resolver")

    return [panel_estado, panel_alertas, panel_errores, panel_respaldos, panel_llm_router, panel_reconocer_alerta,
            panel_resolver_alerta, panel_resolver_error]
