import base64
import json
import os
import random

import requests
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from src.core.logging import get_logger
from src.services.agent.jarvis.agent import get_jarvis
from src.services.auth.auth.auth_middleware import get_current_user, get_owner, es_dueno
from src.services.agent.jarvis.notices import avisos_pendientes
from src.services.agent.jarvis.voz import frases, quitar_nombre, sin_nombre_al_inicio

logger = get_logger("tars")

tars_router = APIRouter()

MIENTRAS_BUSCA = ["Un momento.", "Déjame revisar.", "Revisando.", "Dame un segundo."]
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


def _hablar(texto: str, antes: str = "", despues: str = "") -> bytes:
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOZ_TARS}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        json={"text": texto, "model_id": MODELO_VOZ, "voice_settings": {"speed": 0.9},
              **({"previous_text": antes} if antes else {}), **({"next_text": despues} if despues else {})},
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
    resto = quitar_nombre(texto) if texto else None
    if wake:
        return {"awake": resto is not None, "text": resto or ""}
    # Sin exigir el nombre (barra espaciadora, seguimiento, o el navegador ya oyó "TARS"): igual se le quita si vino
    return {"awake": bool(texto), "text": texto if resto is None else resto}


def _evento(**datos) -> str:
    return json.dumps(datos, ensure_ascii=False) + "\n"


def _audio(texto: str, antes: str = "", despues: str = "") -> str:
    # previous_text/next_text: ElevenLabs mantiene la entonación entre frases sueltas
    return _evento(type="audio", text=texto, mp3=base64.b64encode(_hablar(texto, antes, despues)).decode())


@tars_router.post("/reply")
def tars_reply(payload: TarsReplyIn, user: dict = Depends(get_owner)):
    """Lo pedido -> agente JARVIS con la personalidad de TARS -> voz. Responde en NDJSON, un evento por línea:
    {"type":"audio","text","mp3"(base64)} frase a frase, {"type":"error"} y {"type":"done"} al final."""
    tars = get_jarvis(user["user_id"], client_type="tars")

    # Síncrono a propósito (como el chat v2): FastAPI lo itera en un hilo
    def generar():
        try:
            final, avisado = "", False
            # Un solo hilo para TARS: recuerda lo hablado entre sesiones de voz
            for estado in tars.stream_task(payload.text, user["user_id"], None, f"tars-{user['user_id']}"):
                if "error" in estado:
                    logger.error(f"TARS: el agente falló: {estado['error']}")
                    yield _evento(type="error", detail="TARS no pudo responder")
                    return
                ultimo = (estado.get("messages") or [None])[-1]
                if isinstance(ultimo, AIMessage) and ultimo.tool_calls and not avisado:
                    avisado = True  # usar herramientas tarda: una frase corta para que no quede en silencio
                    yield _audio(random.choice(MIENTRAS_BUSCA))
                elif isinstance(ultimo, AIMessage) and not ultimo.tool_calls:
                    final = ultimo.content
            partes = frases(sin_nombre_al_inicio(final))
            for i, frase in enumerate(partes):
                yield _audio(frase, " ".join(partes[:i]), " ".join(partes[i + 1:]))
        except requests.RequestException:
            logger.exception("TARS: falló ElevenLabs")
            yield _evento(type="error", detail="No se pudo generar la voz")
        yield _evento(type="done")

    return StreamingResponse(generar(), media_type="application/x-ndjson")


@tars_router.post("/say")
def tars_say(payload: TarsReplyIn, user: dict = Depends(get_owner)):
    """Solo la voz de TARS para un texto ya armado (los avisos)."""
    try:
        return Response(content=_hablar(payload.text), media_type="audio/mpeg")
    except requests.RequestException:
        logger.exception("TARS: falló ElevenLabs")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="No se pudo generar la voz")


@tars_router.get("/notices")
def tars_notices(user: dict = Depends(get_owner)):
    """Lo que TARS quiere decir sin que se lo pidan (la página lo consulta cada minuto)."""
    return {"notices": avisos_pendientes(user["user_id"])}
