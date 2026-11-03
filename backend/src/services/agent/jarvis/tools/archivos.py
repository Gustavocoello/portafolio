"""Archivos y vault de home-lab-laptop (MCP por Tailscale, ver servers/mcp_servers/files).

Leer es directo. Cambiar algo va en dos pasos y lo exige este código, no el modelo: archivos_proponer_cambio lo
valida en el servidor sin hacerlo y lo deja pendiente; archivos_confirmar_cambio lo ejecuta solo en un turno
posterior (después de que Gustavo respondió) y antes de 5 minutos. Así nadie mueve ni crea nada sin un "sí".
"""
import os
import re
import time
import unicodedata
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from src.core.logging import get_logger
from .helpers import _run

logger = get_logger("archivos")

VIGENCIA_PENDIENTE = 300   # s para responder "sí"
VIGENCIA_USO = 600         # s en que las herramientas siguen cargadas después de usarlas ("léelo", "muévelo")

_pendientes: dict[str, dict] = {}   # user_id -> cambio propuesto
_ultimo_uso: dict[str, float] = {}  # user_id -> última vez que usó estas herramientas

# Palabras que hacen que el agente cargue estas herramientas (el resto de preguntas no paga sus tokens)
_PALABRAS = re.compile(
    r"\b(archivos?|carpetas?|documentos?|pdfs?|word|docx|vault|obsidian|notas?|apuntes?|anota\w*|apunta\w*|"
    r"papelera|mueve\w*|mover|renombr\w*|guarda\w*|descargas?|ficheros?|home ?lab|inbox)\b"
)


def _normal(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.casefold()) if unicodedata.category(c) != "Mn")


def archivos_disponibles() -> bool:
    return bool(os.getenv("MCP_ARCHIVOS"))


def necesita_archivos(texto: str, user_id: str) -> bool:
    """¿Este mensaje usa archivos? Por palabras, por un cambio esperando respuesta o por uso reciente."""
    if user_id in _pendientes or time.time() - _ultimo_uso.get(user_id, 0) < VIGENCIA_USO:
        return True
    return bool(_PALABRAS.search(_normal(texto)))


def _texto(resultado) -> str:
    partes = [getattr(c, "text", str(c)) for c in (resultado.content or [])]
    return "\n".join(partes) or "(sin respuesta)"


def _llamar(user_id: str, herramienta: str, argumentos: dict) -> str:
    from src.services.mcps.client.base_client import BaseMCPClient  # aquí: fastmcp no hace falta en las pruebas

    _ultimo_uso[user_id] = time.time()
    cliente = BaseMCPClient(url=os.getenv("MCP_ARCHIVOS"), provider="files", user_id=user_id)
    try:
        return _texto(_run(cliente._call_server(herramienta, argumentos)))
    except Exception as e:
        logger.error(f"[ARCHIVOS] {herramienta}: {e}")
        return ("Error: home-lab-laptop no responde (apagada o sin Tailscale). No inventes contenido; dile a "
                f"Gustavo que no pudiste llegar a sus archivos. Detalle: {e}")


def _turno(config: RunnableConfig | None) -> str:
    return ((config or {}).get("configurable") or {}).get("turno", "")


def build_archivos_tools(user_id: str) -> list:
    @tool
    def archivos_listar(ruta: str = "") -> str:
        """Lista una carpeta de los archivos de Gustavo en home-lab-laptop. Sin ruta, muestra las carpetas
        disponibles: vault/ (su vault de Obsidian: 00-Inbox, 10-Proyectos, 20-Áreas, 30-Recursos, 40-Archivo) y
        archivos/ (documentos). Rutas como 'vault/10-Proyectos/TARS'."""
        return _llamar(user_id, "archivos_listar", {"ruta": ruta})

    @tool
    def archivos_buscar(texto: str, ruta: str = "", en_contenido: bool = False) -> str:
        """Busca archivos por nombre (sin importar tildes) en vault/ y archivos/, o solo dentro de 'ruta'.
        en_contenido=True busca también dentro de notas y archivos de texto (más lento). Úsala antes de leer,
        mover o anotar si no sabes la ruta exacta; nunca la adivines."""
        return _llamar(user_id, "archivos_buscar", {"texto": texto, "ruta": ruta, "en_contenido": en_contenido})

    @tool
    def archivos_leer(ruta: str, desde: int = 0) -> str:
        """Lee un archivo: Markdown, texto, PDF o Word (.docx). Devuelve hasta 6000 caracteres; si dice
        'continúa', vuelve a llamarla con ese 'desde'. Resume lo leído; no lo recites entero."""
        return _llamar(user_id, "archivos_leer", {"ruta": ruta, "desde": desde})

    @tool
    def archivos_proponer_cambio(accion: Literal["crear", "anotar", "mover", "papelera"], ruta: str,
                                 destino: str = "", contenido: str = "",
                                 config: RunnableConfig = None) -> str:
        """Prepara un cambio en los archivos SIN hacerlo; después pregúntale a Gustavo y espera su respuesta.
        accion: 'crear' (archivo nuevo .md/.txt/.csv en 'ruta' con 'contenido'), 'anotar' (agrega 'contenido' al
        final de 'ruta'), 'mover' (mueve o renombra 'ruta' a 'destino'), 'papelera' (lo manda a la Papelera:
        nunca se borra nada). Nada se sobrescribe.
        Reglas del vault: antes de crear una nota busca si ya existe y, si existe, anota en ella; lo que no tenga
        lugar claro va a vault/00-Inbox/; toda nota empieza con frontmatter (---, tags: [tipo/...], created:
        AAAA-MM-DD, status: activo, ---); enlaza proyectos y personas con [[Nombre]]; las decisiones llevan fecha
        y porqué; nunca escribas contraseñas, keys ni datos de contacto; no escribas en graphify/, _meta/ ni
        40-Archivo/."""
        if accion == "mover":
            if not destino:
                return "Error: para mover falta 'destino'."
            nombre, args = "archivos_mover", {"origen": ruta, "destino": destino}
        elif accion == "crear":
            nombre, args = "archivos_crear", {"ruta": ruta, "contenido": contenido}
        elif accion == "anotar":
            nombre, args = "archivos_anotar", {"ruta": ruta, "texto": contenido}
        else:
            nombre, args = "archivos_papelera", {"ruta": ruta}
        vista = _llamar(user_id, nombre, {**args, "simular": True})
        if vista.startswith("Error"):
            _pendientes.pop(user_id, None)
            return vista
        _pendientes[user_id] = {"herramienta": nombre, "args": args, "vista": vista,
                                "turno": _turno(config), "hora": time.time()}
        return (f"Pendiente, aún no se hizo: {vista} Pregúntale a Gustavo si lo haces, en una frase, y termina tu "
                "respuesta. Solo si en su próximo mensaje dice que sí, llama archivos_confirmar_cambio.")

    @tool
    def archivos_confirmar_cambio(config: RunnableConfig = None) -> str:
        """Hace el cambio que propusiste con archivos_proponer_cambio. Úsala SOLO cuando Gustavo acaba de
        responder que sí a ese cambio; nunca en el mismo turno en que lo propusiste."""
        pendiente = _pendientes.get(user_id)
        if not pendiente:
            return "No hay ningún cambio pendiente. Propónlo primero con archivos_proponer_cambio."
        if time.time() - pendiente["hora"] > VIGENCIA_PENDIENTE:
            _pendientes.pop(user_id, None)
            return "El cambio propuesto venció (más de 5 minutos). Vuelve a proponerlo y pregunta otra vez."
        if pendiente["turno"] == _turno(config):
            return ("Todavía no: Gustavo no ha respondido. Pregúntale si lo haces y espera su próximo mensaje: "
                    f"{pendiente['vista']}")
        _pendientes.pop(user_id, None)
        return _llamar(user_id, pendiente["herramienta"], {**pendiente["args"], "simular": False})

    @tool
    def archivos_cancelar_cambio() -> str:
        """Descarta el cambio propuesto. Úsala cuando Gustavo diga que no o pida otra cosa."""
        pendiente = _pendientes.pop(user_id, None)
        return f"Cancelado: {pendiente['vista']}" if pendiente else "No había nada pendiente."

    return [archivos_listar, archivos_buscar, archivos_leer, archivos_proponer_cambio, archivos_confirmar_cambio,
            archivos_cancelar_cambio]
