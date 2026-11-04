"""Archivos y vault de home-lab-laptop y archivos de la laptop Windows (el mismo MCP en los dos, por Tailscale; ver
servers/mcp_servers/files). Cada ruta va al equipo de su primera carpeta: vault/ y archivos/ a home-lab-laptop;
documentos/, descargas/, escritorio/, work/ y datos/ a la laptop Windows, que solo responde si está encendida.

Leer es directo. Cambiar algo va en dos pasos y lo exige este código, no el modelo: archivos_proponer_cambio lo
valida en el servidor sin hacerlo y lo deja pendiente; archivos_confirmar_cambio lo ejecuta solo en un turno
posterior (después de que Gustavo respondió) y antes de 5 minutos. Así nadie mueve ni crea nada sin un "sí".
"""
import asyncio
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
import unicodedata
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from src.core.logging import get_logger
from .helpers import _run

logger = get_logger("archivos")

VIGENCIA_PENDIENTE = 300   # s para responder "sí"
ESPERA = 25               # s; la laptop apagada no debe dejar a TARS colgado
VIGENCIA_USO = 600         # s en que las herramientas siguen cargadas después de usarlas ("léelo", "muévelo")

_pendientes: dict[str, dict] = {}   # user_id -> cambio propuesto
_ultimo_uso: dict[str, float] = {}  # user_id -> última vez que usó estas herramientas

# equipo -> (variable con la URL del MCP, cómo decirle a Gustavo cuál es)
EQUIPOS = {"homelab": ("MCP_ARCHIVOS", "home-lab-laptop"), "laptop": ("MCP_ARCHIVOS_LAPTOP", "la laptop Windows")}


def _raices_laptop() -> set[str]:
    texto = os.getenv("MCP_ARCHIVOS_LAPTOP_RAICES", "documentos,descargas,escritorio,work,datos")
    return {r.strip() for r in texto.split(",") if r.strip()}


def _equipos() -> list[str]:
    return [e for e, (variable, _) in EQUIPOS.items() if os.getenv(variable)]


def _equipo(ruta: str) -> str:
    primera = ruta.replace("\\", "/").strip().strip("/").split("/")[0]
    return "laptop" if primera in _raices_laptop() and "laptop" in _equipos() else "homelab"

# Palabras que hacen que el agente cargue estas herramientas (el resto de preguntas no paga sus tokens)
_PALABRAS = re.compile(
    r"\b(archivos?|carpetas?|documentos?|pdfs?|word|docx|vault|obsidian|notas?|apuntes?|anota\w*|apunta\w*|"
    r"papelera|mueve\w*|mover|renombr\w*|guarda\w*|descargas?|ficheros?|home ?lab|inbox|laptop|computador\w*|"
    r"escritorio|repos?|repositorios?|codigo)\b"
)


# El vault de Obsidian, no Notion: con estas palabras (y sin "notion") el agente responde sin las herramientas de Notion
_VAULT = re.compile(r"\b(vault|obsidian|inbox)\b")


def es_del_vault(texto: str) -> bool:
    plano = _normal(texto)
    return bool(_VAULT.search(plano)) and "notion" not in plano


def _normal(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.casefold()) if unicodedata.category(c) != "Mn")


def archivos_disponibles() -> bool:
    return bool(_equipos())


def necesita_archivos(texto: str, user_id: str) -> bool:
    """¿Este mensaje usa archivos? Por palabras, por un cambio esperando respuesta o por uso reciente."""
    if user_id in _pendientes or time.time() - _ultimo_uso.get(user_id, 0) < VIGENCIA_USO:
        return True
    return bool(_PALABRAS.search(_normal(texto)))


def _texto(resultado) -> str:
    partes = [getattr(c, "text", str(c)) for c in (resultado.content or [])]
    return "\n".join(partes) or "(sin respuesta)"


def _llamar(user_id: str, herramienta: str, argumentos: dict, equipo: str = "homelab") -> str:
    from src.services.mcps.client.base_client import BaseMCPClient  # aquí: fastmcp no hace falta en las pruebas

    _ultimo_uso[user_id] = time.time()
    variable, nombre = EQUIPOS[equipo]
    cliente = BaseMCPClient(url=os.getenv(variable), provider="files", user_id=user_id)
    try:
        return _texto(_run(asyncio.wait_for(cliente._call_server(herramienta, argumentos), ESPERA)))
    except Exception as e:
        logger.error(f"[ARCHIVOS] {equipo} {herramienta}: {e!r}")
        return (f"Error: {nombre} no responde (apagada o sin Tailscale). No inventes contenido; dile a Gustavo que "
                f"no pudiste llegar a esos archivos. Detalle: {e!r}")


def _en_todos(user_id: str, herramienta: str, argumentos: dict) -> str:
    """Lo mismo en cada equipo a la vez (listar la raíz, buscar sin ruta): si uno está apagado, el otro responde."""
    equipos = _equipos()
    if len(equipos) == 1:
        return _llamar(user_id, herramienta, argumentos, equipos[0])
    with ThreadPoolExecutor(len(equipos)) as pool:
        respuestas = list(pool.map(lambda e: _llamar(user_id, herramienta, argumentos, e), equipos))
    return "\n\n".join(f"En {EQUIPOS[e][1]}: {r}" for e, r in zip(equipos, respuestas))


def _turno(config: RunnableConfig | None) -> str:
    return ((config or {}).get("configurable") or {}).get("turno", "")


def build_archivos_tools(user_id: str) -> list:
    @tool
    def archivos_listar(ruta: str = "") -> str:
        """Lista una carpeta de los archivos de Gustavo. Sin ruta, muestra las carpetas disponibles. En home-lab-laptop:
        vault/ (su vault de Obsidian: 00-Inbox, 10-Proyectos, 20-Áreas, 30-Recursos, 40-Archivo) y archivos/. En su
        laptop Windows, solo si está encendida: documentos/, descargas/, escritorio/, datos/ y work/ (su código,
        solo lectura). Rutas como 'vault/10-Proyectos/TARS' o 'descargas/factura.pdf'."""
        if not ruta.strip().strip("/"):
            return _en_todos(user_id, "archivos_listar", {"ruta": ""})
        return _llamar(user_id, "archivos_listar", {"ruta": ruta}, _equipo(ruta))

    @tool
    def archivos_buscar(texto: str, ruta: str = "", en_contenido: bool = False) -> str:
        """Busca archivos por nombre (sin importar tildes) en todas las carpetas, o solo dentro de 'ruta'.
        en_contenido=True busca también dentro de notas y archivos de texto (más lento). Úsala antes de leer,
        mover o anotar si no sabes la ruta exacta; nunca la adivines."""
        args = {"texto": texto, "ruta": ruta, "en_contenido": en_contenido}
        if not ruta.strip().strip("/"):
            return _en_todos(user_id, "archivos_buscar", args)
        return _llamar(user_id, "archivos_buscar", args, _equipo(ruta))

    @tool
    def archivos_leer(ruta: str, desde: int = 0) -> str:
        """Lee un archivo: Markdown, texto, PDF o Word (.docx). Devuelve hasta 6000 caracteres; si dice
        'continúa', vuelve a llamarla con ese 'desde'. Resume lo leído; no lo recites entero."""
        return _llamar(user_id, "archivos_leer", {"ruta": ruta, "desde": desde}, _equipo(ruta))

    @tool
    def archivos_proponer_cambio(accion: Literal["crear", "anotar", "mover", "papelera"], ruta: str,
                                 destino: str = "", contenido: str = "",
                                 config: RunnableConfig = None) -> str:
        """Prepara un cambio en los archivos SIN hacerlo; después pregúntale a Gustavo y espera su respuesta.
        accion: 'crear' (archivo nuevo .md/.txt/.csv en 'ruta' con 'contenido'), 'anotar' (agrega 'contenido' al
        final de 'ruta'), 'mover' (mueve o renombra 'ruta' a 'destino'), 'papelera' (lo manda a la Papelera:
        nunca se borra nada). Nada se sobrescribe ni pasa de un equipo a otro; work/ es solo lectura.
        Reglas del vault: antes de crear una nota busca si ya existe y, si existe, anota en ella; lo que no tenga
        lugar claro va a vault/00-Inbox/; toda nota empieza con frontmatter (---, tags: [tipo/...], created:
        AAAA-MM-DD, status: activo, ---); enlaza proyectos y personas con [[Nombre]]; las decisiones llevan fecha
        y porqué; nunca escribas contraseñas, keys ni datos de contacto; no escribas en graphify/, _meta/ ni
        40-Archivo/."""
        equipo = _equipo(ruta)
        if accion == "mover":
            if not destino:
                return "Error: para mover falta 'destino'."
            if _equipo(destino) != equipo:
                return "Error: no se mueve entre home-lab-laptop y la laptop Windows; solo dentro del mismo equipo."
            nombre, args = "archivos_mover", {"origen": ruta, "destino": destino}
        elif accion == "crear":
            nombre, args = "archivos_crear", {"ruta": ruta, "contenido": contenido}
        elif accion == "anotar":
            nombre, args = "archivos_anotar", {"ruta": ruta, "texto": contenido}
        else:
            nombre, args = "archivos_papelera", {"ruta": ruta}
        vista = _llamar(user_id, nombre, {**args, "simular": True}, equipo)
        if vista.startswith("Error"):
            _pendientes.pop(user_id, None)
            return vista
        _pendientes[user_id] = {"herramienta": nombre, "args": args, "vista": vista, "equipo": equipo,
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
        return _llamar(user_id, pendiente["herramienta"], {**pendiente["args"], "simular": False},
                       pendiente["equipo"])

    @tool
    def archivos_cancelar_cambio() -> str:
        """Descarta el cambio propuesto. Úsala cuando Gustavo diga que no o pida otra cosa."""
        pendiente = _pendientes.pop(user_id, None)
        return f"Cancelado: {pendiente['vista']}" if pendiente else "No había nada pendiente."

    return [archivos_listar, archivos_buscar, archivos_leer, archivos_proponer_cambio, archivos_confirmar_cambio,
            archivos_cancelar_cambio]
