import os

import requests
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from src.core.logging import get_logger
from src.services.agent.jarvis.agent import get_jarvis
from src.services.auth.auth.auth_middleware import get_current_user, get_owner, es_dueno
from src.services.agent.jarvis.wake import quitar_nombre

logger = get_logger("tars")

tars_router = APIRouter()

MAX_AUDIO_BYTES = 5 * 1024 * 1024  # una frase en webm/opus pesa decenas de KB
VOZ_TARS = os.getenv("ELEVENLABS_VOICE_ID", "WCGigPIhyge6PQnb64UL")
MODELO_VOZ = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")  # la mitad de créditos que multilingual v2
ROUTER_URL = os.getenv("LLM_ROUTER_URL", "https://llm.brokeria.ec/v1")

def _transcribir(audio: bytes, nombre: str, tipo: str) -> str:
    # Por el llm-router con model "tars": usa las keys de Groq de TARS, no las de los brokers
    r = requests.post(
        f"{ROUTER_URL}/audio/transcriptions",
        headers={"Authorization": f"Bearer {os.environ['LLM_ROUTER_KEY']}"},
        files={"file": (nombre, audio, tipo)},
        data={"model": "tars", "language": "es", "prompt": "TARS"},  # el prompt ayuda a escribir bien el nombre
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("text", "").strip()


def _hablar(texto: str) -> bytes:
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOZ_TARS}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        json={"text": texto, "model_id": MODELO_VOZ, "voice_settings": {"speed": 0.9}},
        timeout=60,
    )
    r.raise_for_status()
    return r.content


@tars_router.get("/access")
def tars_access(user: dict = Depends(get_current_user)):
    return {"owner": es_dueno(user)}


class TarsReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


# Dos pasos, como Alexa: /hear confirma rápido si la frase era para TARS (el navegador suena) y /reply responde
@tars_router.post("/hear")
async def tars_hear(audio: UploadFile = File(...), wake: bool = Form(True), user: dict = Depends(get_owner)):
    """Transcribe una frase. Con wake=true solo cuenta si empieza con su nombre.
    Devuelve {"awake": bool, "text": lo que pidió o ""}: awake sin texto = solo dijo "TARS"."""
    datos = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(datos) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Audio demasiado largo")
    try:
        texto = await run_in_threadpool(_transcribir, datos, audio.filename or "voz.webm", audio.content_type or "audio/webm")
    except requests.RequestException:
        logger.exception("TARS: falló la transcripción")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="No se pudo transcribir")
    if wake:
        texto = quitar_nombre(texto) if texto else None
        return {"awake": texto is not None, "text": texto or ""}
    return {"awake": bool(texto), "text": texto}


@tars_router.post("/reply")
async def tars_reply(payload: TarsReplyIn, user: dict = Depends(get_owner)):
    """Lo pedido -> agente JARVIS con la personalidad de TARS -> voz de ElevenLabs (mp3)."""
    tars = get_jarvis(user["user_id"], client_type="tars")
    # Un solo hilo para TARS: recuerda lo hablado entre sesiones de voz
    result = await run_in_threadpool(tars.run_task, payload.text, user["user_id"], None, f"tars-{user['user_id']}")
    if result.get("status") != "completed":
        logger.error(f"TARS: el agente falló: {result.get('output')}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TARS no pudo responder")
    try:
        mp3 = await run_in_threadpool(_hablar, result["output"])
    except requests.RequestException:
        logger.exception("TARS: falló ElevenLabs")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="No se pudo generar la voz")
    return Response(content=mp3, media_type="audio/mpeg")
