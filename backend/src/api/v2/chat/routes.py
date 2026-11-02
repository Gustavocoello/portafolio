import os
import json
from uuid import UUID
from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from io import BytesIO

# Importaciones de LangChain/LangGraph necesarias para parsear los pensamientos
from langchain_core.messages import AIMessage

# Tus dependencias internas
from src.core.logging import get_logger
from src.core.time_helper import get_now
from src.database.settings.connection import get_db, SessionLocal
from src.database.models.models import Chat, Message
from src.services.cache.redis_sidebar import SidebarCache
from src.services.cache.redis_cache import ChatCache
from src.services.rag.pipeline import RAGPipeline
from src.services.integrations.azure.azure_vision import analyze_image_with_azure
from src.services.integrations.microsoft.markitdown_extractor import extract_text_from_file
from src.services.agent.jarvis.agent import get_jarvis
from src.services.auth.auth.auth_middleware import get_current_user, es_dueno
from src.services.llm.chat.free_tier import generate_prompt, visitor_message_count, visitor_ip, VISITOR_LIMIT

logger = get_logger("chat_service_v2")

chat_v2_router = APIRouter()

# --- MODELOS DE ENTRADA ---
class SendMessageV2Request(BaseModel):
    text: str
    hidden_context: Optional[str] = ""

# =================================================================
# 1. RUTA DE AGENTES
# =================================================================
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
DEFAULT_TITLES = (None, "", "Sin titulo", "Sin título")

@chat_v2_router.post("/{chat_id}/message")
def send_message_v2(
    chat_id: UUID,
    payload: SendMessageV2Request,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user)
):
    try:
        user_text = payload.text.strip()
        if not user_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty message")

        # Visitantes: las herramientas leen el correo y la agenda del dueño, así que solo chat simple y con tope.
        # El tope es por IP (igual que sin cuenta) para que crear una cuenta no dé mensajes extra.
        owner = es_dueno(user)
        if not owner:
            ip = visitor_ip(request)
            count = visitor_message_count(f"ip:{ip}")
            if count is None:
                raise HTTPException(status_code=503, detail="Modo de prueba no disponible por ahora.")
            if count > VISITOR_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"error": f"Has alcanzado el límite de {VISITOR_LIMIT} mensajes de prueba."}
                )

        # 1. Buscar o Crear Chat
        chat = db.query(Chat).filter(
            Chat.id == chat_id, Chat.user_id == user["user_id"], Chat.app_id == user["app_id"]
        ).first()

        if not chat:
            chat = Chat(id=chat_id, user_id=user["user_id"], app_id=user["app_id"], title="Sin título")
            db.add(chat)
            db.flush()

        # 2. Guardar mensaje
        chat.updated_at = get_now()
        user_message = Message(chat_id=chat.id, role="user", content=user_text)
        db.add(user_message)

        # 3. Contexto Oculto
        hidden_context = payload.hidden_context.strip()
        if hidden_context:
            db.query(Message).filter_by(chat_id=chat.id, role="context").delete()
            context_msg = Message(chat_id=chat.id, role="context", content=hidden_context)
            db.add(context_msg)
            db.commit()

        # 4. Agente
        jarvis_agent = get_jarvis(user["user_id"]) if owner else None

        # 6. Autogenerar título
        if chat.title in DEFAULT_TITLES:
            words = user_text.split()
            chat.title = " ".join(words[:10]) + ("..." if len(words) > 10 else "")
            db.commit()
            SidebarCache.invalidate_user(user["user_id"], user["app_id"])

        # ==========================================================
        # EL GENERADOR DE PENSAMIENTOS (ENTERPRISE GRADE)
        # ==========================================================
        # Síncrono a propósito: FastAPI lo itera en un hilo y el agente no congela al resto de requests
        def generate():
            gen_session = SessionLocal()
            try:
                full_reply = ""
                if not owner:
                    full_reply = generate_prompt({"description": user_text})  # sin memoria ni herramientas
                else:
                    # El hilo de memoria del agente es el chat: así recuerda la conversación entre mensajes
                    for state_chunk in jarvis_agent.stream_task(user_text, user["user_id"], chat_id=str(chat_id), thread_id=str(chat_id)):
                        if "error" in state_chunk:
                            yield f"[ERROR] {state_chunk['error']}"
                            return
                        messages = state_chunk.get("messages", [])
                        last_msg = messages[-1] if messages else None
                        if isinstance(last_msg, AIMessage) and not last_msg.tool_calls:
                            full_reply = last_msg.content

                if full_reply:
                    yield full_reply
                    inner_chat = gen_session.get(Chat, chat_id)
                    inner_chat.updated_at = get_now()
                    new_msg = Message(chat_id=chat_id, role="assistant", content=full_reply)
                    gen_session.add(new_msg)
                    gen_session.commit()
                    ChatCache.append_message(str(chat_id), {
                        "id": new_msg.id, "role": "assistant",
                        "content": full_reply, "created_at": get_now().isoformat()
                    })
            except Exception as e:
                gen_session.rollback()
                logger.exception("Error during agent stream")
                yield f"\n[ERROR] {str(e)}"
            finally:
                gen_session.close()

        return StreamingResponse(generate(), media_type="text/plain")

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error in send_message_v2")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# =================================================================
# 2. RUTA DE EXTRACCIÓN MASIVA (10K+ IMAGES & DOCS + RAG)
# =================================================================
@chat_v2_router.post("/extract_file")
async def extract_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user)
):
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty filename")

    original_filename = file.filename
    content_type = file.content_type or ""
    
    # Leer el archivo en memoria asíncronamente
    file_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="El archivo supera los 10 MB")
    final_text = ""
    user_uuid = user["user_id"]

    try:
        if content_type.startswith("image/"):
            # IMPORTANTE: run_in_threadpool evita que Azure bloquee el servidor entero
            final_text = await run_in_threadpool(analyze_image_with_azure, file_bytes, user_id=user_uuid)
            resp_text = f"Image '{original_filename}':\n\n{final_text}"
        else:
            file_stream = BytesIO(file_bytes)
            # Extracción de PDF/Excel pesada a un hilo secundario
            final_text = await run_in_threadpool(extract_text_from_file, file_stream, original_filename)
            resp_text = f"Document '{original_filename}':\n\n{final_text}"
        
        # Ingesta en la Base de Datos Vectorial (RAG)
        if final_text and final_text.strip():
            # Empaquetamos la lógica de RAG en una función sincrónica
            def ingest_to_rag(db_sess, u_id, txt, f_name, c_type):
                rag_pipeline = RAGPipeline(db_sess)
                rag_pipeline.ingest_document(
                    user_id=u_id,
                    text=txt,
                    metadata={
                        "filename": f_name,
                        "mime_type": c_type,
                        "source": "upload"
                    }
                )
            
            # Ejecutamos el RAG vectorial en un thread pool para no congelar peticiones concurrentes
            await run_in_threadpool(
                ingest_to_rag, db, user_uuid, final_text, original_filename, content_type
            )

        return {
            "text": resp_text,
            "filename": original_filename,
            "status": "extracted_successfully"
        }

    except Exception as e:
        logger.exception("Error processing file in v2")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))