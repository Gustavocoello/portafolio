# src/services/agent/jarvis/tools/email.py
import os
import re
import email
import imaplib
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from datetime import timedelta

from langchain_core.tools import tool
from src.core.logging import get_logger
from src.core.time_helper import get_now

logger = get_logger("email_tools")

MAX_CUERPO = 4000  # caracteres por correo: suficiente para resumir sin llenar el contexto
INICIO_CORREO = 65536  # bytes que bajan los avisos por correo: alcanza para cabeceras y texto, sin los adjuntos
LISTA_CARPETA = re.compile(r'\((?P<flags>[^)]*)\) (?:"[^"]*"|NIL) (?P<nombre>.+)$')  # una línea de IMAP LIST
ID_CORREO = re.compile(r"(?P<enviados>enviados\s*:\s*)?(?P<uid>\d+)", re.IGNORECASE)  # "[enviados:45]", "45", "id 45"
MESES_IMAP = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
IMAP_TIMEOUT = 20    # sin esto un servidor lento dejaba colgada la petición (y su hilo) sin límite


def _conectar() -> imaplib.IMAP4_SSL:
    # shortcut: un solo buzón desde el .env (el de Gustavo); pasar a credenciales por usuario si hay más usuarios
    imap = imaplib.IMAP4_SSL(os.environ["MAIL_IMAP_HOST"], int(os.getenv("MAIL_IMAP_PORT", "993")), timeout=IMAP_TIMEOUT)
    imap.login(os.environ["MAIL_USER"], os.environ["MAIL_PASSWORD"])
    imap.select("INBOX", readonly=True)  # solo lectura: leer no marca los correos como vistos
    return imap


def _h(valor) -> str:
    return str(make_header(decode_header(valor or "")))


def _texto(msg: email.message.Message) -> str:
    partes = msg.walk() if msg.is_multipart() else [msg]
    for parte in partes:
        if parte.get_content_type() == "text/plain" and not parte.get_filename():
            datos = parte.get_payload(decode=True) or b""
            return datos.decode(parte.get_content_charset() or "utf-8", errors="replace")
    return "(el correo no tiene texto plano)"


def _limpio(valor: str) -> str:
    """Lo que el modelo escribe para buscar, sin saltos de línea ni espacios de más."""
    return " ".join((valor or "").split())


def _citar(valor: str) -> str:
    """Cadena IMAP entre comillas, con las comillas y barras escapadas."""
    return '"' + valor.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _resumen(uid: bytes, msg: email.message.Message) -> str:
    try:
        fecha = parsedate_to_datetime(msg["Date"]).strftime("%d/%m %H:%M")
    except (TypeError, ValueError):
        fecha = "?"
    return f"[{uid.decode()}] {fecha} | De: {_h(msg['From'])} | Asunto: {_h(msg['Subject'])}"


def correos_pendientes(limite: int = 10) -> str:
    """Lista los correos sin leer más recientes (id, fecha, remitente, asunto)."""
    imap = _conectar()
    try:
        _, data = imap.uid("search", None, "UNSEEN")
        uids = data[0].split()[-limite:][::-1]
        if not uids:
            return "No hay correos sin leer."
        lineas = []
        for uid in uids:
            _, partes = imap.uid("fetch", uid, "(BODY.PEEK[HEADER])")
            lineas.append(_resumen(uid, email.message_from_bytes(partes[0][1])))
        return f"{len(data[0].split())} sin leer. Los más recientes:\n" + "\n".join(lineas)
    finally:
        imap.logout()


def sin_leer(limite: int = 20, omitir=(), solo_uids: bool = False) -> tuple[list[str], list[dict]]:
    """Correos sin leer más recientes: (uids, correos con uid, remitente, asunto y el inicio del texto).

    Solo baja los que no están en `omitir`, y de cada uno solo el inicio: antes bajaba completos (con adjuntos)
    los 20 cada minuto y los avisos de TARS tardaban más de un minuto.
    """
    imap = _conectar()
    try:
        _, data = imap.uid("search", None, "UNSEEN")
        uids = [u.decode() for u in data[0].split()[-limite:][::-1]]
        correos = []
        for uid in ([] if solo_uids else [u for u in uids if u not in omitir]):
            _, partes = imap.uid("fetch", uid, f"(BODY.PEEK[]<0.{INICIO_CORREO}>)")
            if not partes or not isinstance(partes[0], tuple):
                continue
            msg = email.message_from_bytes(partes[0][1])
            correos.append({"uid": uid, "de": _h(msg["From"]), "asunto": _h(msg["Subject"]), "texto": _texto(msg)[:500]})
        return uids, correos
    finally:
        imap.logout()


def _carpeta_enviados(imap) -> str | None:
    """Nombre de la carpeta de enviados en este servidor ("Sent", "INBOX.Sent", "Enviados"...)."""
    _, carpetas = imap.list()
    nombres = []
    for linea in carpetas or []:
        texto = linea.decode(errors="replace") if isinstance(linea, bytes) else str(linea)
        # (\HasNoChildren \Sent) "." INBOX.Sent  -> el nombre puede venir con o sin comillas
        m = LISTA_CARPETA.match(texto)
        if not m:
            continue
        nombre = m["nombre"].strip()
        if nombre.startswith('"') and nombre.endswith('"'):
            nombre = nombre[1:-1].replace('\\"', '"')
        if "\\Sent" in m["flags"]:
            return nombre
        nombres.append(nombre)
    return next((n for n in nombres if n.lower().split(".")[-1].split("/")[-1] in ("sent", "sent items", "enviados", "sent messages")), None)


def buscar_correos(texto: str = "", remitente: str = "", dias: int = 7, limite: int = 10, enviados: bool = False) -> str:
    """Busca en todo el buzón, leídos y no leídos (o en enviados): los más recientes primero."""
    imap = _conectar()
    try:
        prefijo = ""
        if enviados:
            carpeta = _carpeta_enviados(imap)
            if not carpeta:
                return "No encontré la carpeta de enviados."
            imap.select(f'"{carpeta}"', readonly=True)
            prefijo = "enviados:"
        desde = get_now() - timedelta(days=max(1, dias))
        # el mes en inglés a mano: con %b y el idioma del sistema en español salía "nov." y el servidor lo rechaza
        criterios = ["SINCE", f"{desde.day:02d}-{MESES_IMAP[desde.month - 1]}-{desde.year}"]
        texto, remitente = _limpio(texto), _limpio(remitente)
        filtrar_remitente = ""
        # imaplib manda un solo literal (va al final): el texto con tildes va como literal y, si el remitente también
        # las trae, se filtra aquí. Entre comillas solo va ASCII escapado: comillas o eñes ahí daban "Invalid
        # characters in atom" o un error de ascii.
        literal = texto if texto and not texto.isascii() else (remitente if remitente and not remitente.isascii() else "")
        campo = "TO" if enviados else "FROM"
        if remitente and remitente != literal:
            if remitente.isascii():
                criterios += [campo, _citar(remitente)]
            else:
                filtrar_remitente = remitente
        if texto and texto != literal:
            criterios += ["TEXT", _citar(texto)]
        if literal:
            imap.literal = literal.encode("utf-8")
            criterios += ["TEXT" if literal == texto else campo]
            _, data = imap.uid("search", "CHARSET", "UTF-8", *criterios)
        else:
            _, data = imap.uid("search", None, *criterios)
        todos = data[0].split() if data and data[0] else []
        if not todos:
            return "No encontré correos con esos datos."
        lineas = []
        for uid in todos[-limite:][::-1]:
            _, partes = imap.uid("fetch", uid, "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])")
            if not partes or not isinstance(partes[0], tuple):
                continue
            msg = email.message_from_bytes(partes[0][1])
            if filtrar_remitente and filtrar_remitente.casefold() not in _h(msg["To" if enviados else "From"]).casefold():
                continue
            leido = "" if enviados or b"\\Seen" in partes[0][0] else " (sin leer)"
            linea = _resumen(uid, msg).replace(f"[{uid.decode()}]", f"[{prefijo}{uid.decode()}]", 1)
            if enviados:
                linea = linea.replace("| De: ", f"| Para: {_h(msg['To'])} | De: ", 1)
            lineas.append(linea + leido)
        return f"{len(todos)} correos en los últimos {dias} días. Los más recientes:\n" + "\n".join(lineas)
    finally:
        imap.logout()


def leer_correo(uid: str) -> str:
    """Devuelve remitente, asunto y texto de un correo por su id ("123" o "enviados:45")."""
    imap = _conectar()
    try:
        m = ID_CORREO.search(uid or "")
        if not m:
            return f"No existe el correo {uid}: usa el número entre corchetes de email_pendientes o email_buscar."
        limpio = ("enviados:" if m["enviados"] else "") + m["uid"]
        if limpio.startswith("enviados:"):
            carpeta = _carpeta_enviados(imap)
            if not carpeta:
                return "No encontré la carpeta de enviados."
            imap.select(f'"{carpeta}"', readonly=True)
            limpio = limpio.split(":", 1)[1]
        _, partes = imap.uid("fetch", limpio, "(BODY.PEEK[])")
        if not partes or partes[0] is None:
            return f"No existe el correo {uid}."
        msg = email.message_from_bytes(partes[0][1])
        return _resumen(limpio.encode(), msg) + "\n\n" + _texto(msg)[:MAX_CUERPO]
    finally:
        imap.logout()


def build_email_tools() -> list:
    if not os.getenv("MAIL_IMAP_HOST"):
        logger.warning("MAIL_IMAP_HOST no está en el .env: JARVIS queda sin correo")
        return []

    @tool
    def email_pendientes(limite: int = 10) -> str:
        """Lista los correos sin leer del buzón de trabajo (id, fecha, remitente y asunto).
        Úsala cuando el usuario pregunte por correos pendientes, nuevos o sin leer."""
        try:
            return correos_pendientes(limite)
        except Exception as e:
            logger.error(f"[EMAIL] {e}")
            return f"No pude leer el correo: {e}"

    @tool
    def email_buscar(texto: str = "", remitente: str = "", dias: int = 7, limite: int = 10, enviados: bool = False) -> str:
        """Busca en TODO el buzón de trabajo, leídos y no leídos (id, fecha, remitente, asunto).
        Úsala para correos ya leídos, de una persona o empresa, sobre un tema, o de varios días atrás.
        texto: palabras del asunto o del cuerpo. remitente: nombre o correo de quien escribió.
        dias: cuántos días hacia atrás (por defecto 7). enviados=True busca en los correos que Gustavo envió."""
        try:
            return buscar_correos(texto, remitente, dias, limite, enviados)
        except Exception as e:
            logger.error(f"[EMAIL] {e}")
            return f"No pude buscar en el correo: {e}"

    @tool
    def email_leer(uid: str) -> str:
        """Lee el contenido de un correo. Input: el id que aparece entre corchetes en email_pendientes o email_buscar."""
        try:
            return leer_correo(uid)
        except Exception as e:
            logger.error(f"[EMAIL] {e}")
            return f"No pude abrir el correo {uid}: {e}"

    return [email_pendientes, email_buscar, email_leer]
