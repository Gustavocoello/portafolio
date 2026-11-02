"""Avisos que TARS da por iniciativa propia: saludo de la mañana, correos urgentes y eventos que están por empezar."""
import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

from src.core.logging import get_logger
from src.core.time_helper import get_now, TIMEZONE
from src.services.cache.redis_client import redis_client
from src.services.llm.chat.llm_router import completion

logger = get_logger("tars_notices")

HORARIO = (7, 22)        # fuera de este horario TARS no habla solo
AVISO_EVENTO_MIN = 10    # minutos antes de un evento
CACHE_AGENDA_S = 300     # el calendario se consulta como mucho cada 5 minutos
DIA = 86400
PERSONALIDAD = (Path(__file__).resolve().parent / "TARS.md").read_text(encoding="utf-8")
# "• 02/11/2026 de 09:30 a 10:00: Reunión con Ana en Oficina" (formato del MCP de calendario)
EVENTO = re.compile(r"•\s*(\d{2}/\d{2}/\d{4}) de (\d{2}:\d{2}) a \d{2}:\d{2}: (.+)")


def _r():
    return redis_client.client


def _primera_vez(key: str, ttl: int) -> bool:
    """True solo la primera vez que se pide esta key (dentro del ttl)."""
    return bool(_r().set(key, "1", nx=True, ex=ttl))


def _hablar_como_tars(instruccion: str, datos: str) -> str:
    return completion([
        {"role": "system", "content": PERSONALIDAD},
        {"role": "user", "content": f"{instruccion}\n\nDatos:\n{datos}"},
    ])


def _agenda_hoy(user_id: str) -> str:
    key = f"tars:agenda:{user_id}"
    if (guardada := _r().get(key)) is not None:
        return guardada
    try:
        from src.services.agent.jarvis.tools.helpers import _parse_mcp_result, _run
        from src.services.mcps.client.client_manager import MCPClientManager
        cliente = MCPClientManager(user_id=user_id).get_client("google_calendar")
        texto = _parse_mcp_result(_run(cliente.google_resumen_diario())) if cliente else ""
    except Exception as e:  # sin calendario conectado TARS sigue con el resto de avisos
        logger.warning(f"Avisos: no se pudo leer el calendario: {e}")
        texto = ""
    _r().set(key, texto, ex=CACHE_AGENDA_S)
    return texto


def eventos_por_empezar(agenda: str, ahora: datetime) -> list[tuple[str, str]]:
    """(hora, título) de los eventos que empiezan en los próximos AVISO_EVENTO_MIN minutos."""
    proximos = []
    for fecha, hora, titulo in EVENTO.findall(agenda):
        inicio = TIMEZONE.localize(datetime.strptime(f"{fecha} {hora}", "%d/%m/%Y %H:%M"))
        if ahora <= inicio <= ahora + timedelta(minutes=AVISO_EVENTO_MIN):
            proximos.append((hora, titulo.strip()))
    return proximos


def _avisos_agenda(user_id: str, ahora: datetime) -> list[str]:
    avisos = []
    for hora, titulo in eventos_por_empezar(_agenda_hoy(user_id), ahora):
        if _primera_vez(f"tars:evento:{user_id}:{ahora.date()}:{hora}:{titulo}", DIA):
            avisos.append(f"Gustavo, a las {hora} tienes {titulo}.")
    return avisos


def _avisos_correo(user_id: str) -> list[str]:
    if not os.getenv("MAIL_IMAP_HOST"):
        return []
    from src.services.agent.jarvis.tools.email import sin_leer
    vistos = f"tars:correos:{user_id}"
    primera = not _r().exists(vistos)
    correos = sin_leer()
    nuevos = [c for c in correos if not _r().sismember(vistos, c["uid"])]
    if correos:
        _r().sadd(vistos, *[c["uid"] for c in correos])
    _r().sadd(vistos, "-")  # marca que ya hubo una primera revisión aunque no haya correos
    _r().expire(vistos, 30 * DIA)
    if primera or not nuevos:  # la primera vez solo toma nota: no lee de golpe todo lo pendiente
        return []
    lista = "\n".join(f"[{c['uid']}] De: {c['de']} | Asunto: {c['asunto']} | {c['texto'][:300]}" for c in nuevos)
    respuesta = _hablar_como_tars(
        "Llegaron estos correos al buzón de trabajo de Gustavo (broker de seguros). Elige solo los urgentes: "
        "un cliente con un siniestro, un pago o una póliza por vencer, algo con plazo de hoy o mañana, o su jefe. "
        "Ignora boletines, publicidad y notificaciones automáticas. Responde SOLO un JSON: una lista de textos, "
        "uno por correo urgente, cada uno una frase para decir en voz alta (quién escribe y qué necesita). "
        "Si ninguno es urgente, responde [].",
        lista,
    )
    try:
        avisos = json.loads(respuesta[respuesta.index("["): respuesta.rindex("]") + 1])
        return [a for a in avisos if isinstance(a, str) and a.strip()][:3]
    except ValueError:
        logger.warning(f"Avisos: respuesta no era JSON: {respuesta[:200]}")
        return []


def _saludo_manana(user_id: str, ahora: datetime) -> list[str]:
    if not _primera_vez(f"tars:saludo:{user_id}:{ahora.date()}", DIA):
        return []
    from src.services.agent.jarvis.tools.email import correos_pendientes
    try:
        correo = correos_pendientes(5) if os.getenv("MAIL_IMAP_HOST") else "Sin correo configurado."
    except Exception as e:
        correo = f"No se pudo leer el correo: {e}"
    return [_hablar_como_tars(
        "Es la primera vez que Gustavo te ve hoy. Salúdalo según la hora y dale en dos o tres frases lo importante "
        "del día: sus eventos y cuántos correos sin leer tiene. Sin listas.",
        f"Hora: {ahora.strftime('%H:%M')}\n\nAgenda:\n{_agenda_hoy(user_id) or 'Sin datos del calendario.'}\n\nCorreo:\n{correo}",
    )]


def avisos_pendientes(user_id: str) -> list[str]:
    """Lo que TARS debería decir ahora sin que se lo pidan. Vacío fuera del horario o sin Redis."""
    ahora = get_now()
    if not (HORARIO[0] <= ahora.hour < HORARIO[1]) or not redis_client.is_available():
        return []
    avisos = []
    for fuente in (lambda: _saludo_manana(user_id, ahora), lambda: _avisos_agenda(user_id, ahora), lambda: _avisos_correo(user_id)):
        try:
            avisos += fuente()
        except Exception:
            logger.exception("Avisos: falló una fuente")
    return avisos
