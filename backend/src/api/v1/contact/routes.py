import os
import smtplib
from email.message import EmailMessage
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from src.core.logging import get_logger
from src.database.models.models import ContactRequest
from src.database.settings.connection import get_db
from src.services.cache.redis_client import redis_client

logger = get_logger("contact")

contact_router = APIRouter()

CONTACT_LIMIT = 3  # formularios por IP al día: frena el spam sin molestar a un visitante real
MOTIVOS = {"demo": "Quiere una prueba de TARS", "similar": "Quiere implementar algo parecido"}


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    reason: Literal["demo", "similar"]
    message: str = Field(min_length=1, max_length=4000)


def _avisar(pedido: dict) -> None:
    """Correo al dueño con el pedido. Si falla queda en la tabla contact_requests."""
    destino = os.getenv("OWNER_EMAIL") or os.getenv("MAIL_USER")
    try:
        msg = EmailMessage()
        msg["Subject"] = f"Portafolio: {MOTIVOS[pedido['reason']]} ({pedido['name']})"
        msg["From"] = os.environ["MAIL_USER"]
        msg["To"] = destino
        msg["Reply-To"] = pedido["email"]
        msg.set_content(f"Nombre: {pedido['name']}\nCorreo: {pedido['email']}\nMotivo: {MOTIVOS[pedido['reason']]}\n\n{pedido['message']}")
        host = os.getenv("MAIL_SMTP_HOST") or os.environ["MAIL_IMAP_HOST"]
        with smtplib.SMTP_SSL(host, int(os.getenv("MAIL_SMTP_PORT", "465")), timeout=20) as smtp:
            smtp.login(os.environ["MAIL_USER"], os.environ["MAIL_PASSWORD"])
            smtp.send_message(msg)
    except Exception:
        logger.exception("Contacto: no se pudo enviar el aviso por correo (el pedido sí quedó guardado)")


@contact_router.post("/api/v1/contact", status_code=status.HTTP_201_CREATED)
def contact(payload: ContactIn, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    if not redis_client.is_available():
        raise HTTPException(status_code=503, detail="El formulario no está disponible por ahora.")
    ip = request.client.host if request.client else "unknown"
    key = f"contact:{ip}"
    count = redis_client.client.incr(key)
    if count == 1:
        redis_client.client.expire(key, 86400)
    if count > CONTACT_LIMIT:
        raise HTTPException(status_code=429, detail="Ya enviaste varios mensajes hoy. Intenta mañana.")

    pedido = payload.model_dump()
    db.add(ContactRequest(**pedido))
    db.commit()
    background.add_task(_avisar, pedido)
    return {"ok": True}
