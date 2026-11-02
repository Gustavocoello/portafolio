# src/services/agent/jarvis/tools/email.py
import os
import email
import imaplib
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime

from langchain_core.tools import tool
from src.core.logging import get_logger

logger = get_logger("email_tools")

MAX_CUERPO = 4000  # caracteres por correo: suficiente para resumir sin llenar el contexto


def _conectar() -> imaplib.IMAP4_SSL:
    # shortcut: un solo buzón desde el .env (el de Gustavo); pasar a credenciales por usuario si hay más usuarios
    imap = imaplib.IMAP4_SSL(os.environ["MAIL_IMAP_HOST"], int(os.getenv("MAIL_IMAP_PORT", "993")))
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


def sin_leer(limite: int = 20) -> list[dict]:
    """Correos sin leer más recientes como datos: uid, remitente, asunto y el inicio del texto."""
    imap = _conectar()
    try:
        _, data = imap.uid("search", None, "UNSEEN")
        correos = []
        for uid in data[0].split()[-limite:][::-1]:
            _, partes = imap.uid("fetch", uid, "(BODY.PEEK[])")
            if not partes or partes[0] is None:
                continue
            msg = email.message_from_bytes(partes[0][1])
            correos.append({"uid": uid.decode(), "de": _h(msg["From"]), "asunto": _h(msg["Subject"]), "texto": _texto(msg)[:500]})
        return correos
    finally:
        imap.logout()


def leer_correo(uid: str) -> str:
    """Devuelve remitente, asunto y texto de un correo por su id."""
    imap = _conectar()
    try:
        _, partes = imap.uid("fetch", uid.strip("[] "), "(BODY.PEEK[])")
        if not partes or partes[0] is None:
            return f"No existe el correo {uid}."
        msg = email.message_from_bytes(partes[0][1])
        return _resumen(uid.strip("[] ").encode(), msg) + "\n\n" + _texto(msg)[:MAX_CUERPO]
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
    def email_leer(uid: str) -> str:
        """Lee el contenido de un correo. Input: el id que aparece entre corchetes en email_pendientes."""
        try:
            return leer_correo(uid)
        except Exception as e:
            logger.error(f"[EMAIL] {e}")
            return f"No pude abrir el correo {uid}: {e}"

    return [email_pendientes, email_leer]
