import re
import os
import json
from io import BytesIO
from collections import defaultdict
from typing import Optional, Dict, Any
from uuid import UUID
from queue import Queue, Empty
from sqlalchemy import select
# FastAPI
from fastapi import APIRouter, Depends, Request, BackgroundTasks, UploadFile, File, HTTPException, status, Query
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.core.logging import get_logger
from src.core.time_helper import get_now
from src.services.cache.redis_cache import ChatCache
from src.services.cache.redis_client import redis_client
from src.database.settings.connection import SessionLocal, get_db
from src.services.cache.redis_sidebar import SidebarCache
from src.services.llm.chat.free_tier import generate_prompt, visitor_message_count, visitor_ip, VISITOR_LIMIT
from src.database.models.models import Chat, Message, Document
from src.services.auth.auth.auth_middleware import get_current_user, authenticate
from src.services.integrations.onedrive.onedrive_service import upload_to_onedrive, get_user_onedrive_token
from src.services.integrations.azure.azure_vision import analyze_image_with_azure
from src.services.integrations.microsoft.markitdown_extractor import extract_text_from_file

# -- Logger --
logger = get_logger('routes')
# -- Event Queues (una por usuario: cada quien solo ve sus propios eventos) --
# shortcut: colas en memoria del proceso, válido con un solo worker de uvicorn; pasar a Redis pub/sub si se escala a varios
event_queues = defaultdict(Queue)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
DEFAULT_TITLES = (None, "", "Sin titulo", "Sin título")

## -------------- Mensajes de la IA con memoria -----------
search_router = APIRouter()

class SearchPromptRequest(BaseModel):
    prompt: str
    history: list[dict] = []  # turnos previos del chat anónimo (los manda el navegador; free_tier los limpia)

class CreateChatRequest(BaseModel):
    title: Optional[str] = "Sin título"
    
class UpdateTitleRequest(BaseModel):
    title: str

# Función utilitaria para reemplazar a werkzeug.utils.secure_filename
def secure_filename(filename: str) -> str:
    # Remueve caracteres peligrosos del nombre del archivo
    return re.sub(r'[^a-zA-Z0-9_\.-]', '_', os.path.basename(filename))

## ----------- Mensajes de la IA sin memoria --------------
@search_router.post("/prompt")
def handle_search_prompt(request: Request, payload: SearchPromptRequest):
    # El límite vive en el servidor (por IP): una cookie la borra cualquiera
    ip = visitor_ip(request)
    count = visitor_message_count(f"ip:{ip}")
    if count is None:
        raise HTTPException(status_code=503, detail="Modo de prueba no disponible por ahora.")
    if count > VISITOR_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": f"Has alcanzado el límite de {VISITOR_LIMIT} mensajes de prueba. Inicia sesión para seguir conversando.", "login_required": True}
        )

    try:
        result = generate_prompt({"description": payload.prompt}, payload.history)
        return {
            "result": result,
            "remaining": max(0, VISITOR_LIMIT - count)
        }
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Error: IA no disponible")
    except Exception as e:
        logger.exception(f"Error al procesar prompt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------- route principal -------------
chat_router = APIRouter()

#--------------- EVENTS QUEUE ---------------
@chat_router.get("/events")
def events(
    token: str = Query(..., description="EventSource no puede mandar headers: el token va en la URL"),
    app_id: str = Query("jarvis-default"),
):
    user_id = str(authenticate(token, app_id)["user_id"])
    queue = event_queues[user_id]

    async def stream():
        while True:
            try:
                # Usamos run_in_threadpool porque Queue.get() de Python bloquea el hilo
                event = await run_in_threadpool(queue.get, timeout=20)
                yield f"data: {json.dumps(event)}\n\n"
            except Empty:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
            except Exception as e:
                logger.error(f"Error en stream SSE: {e}")
                break

    return StreamingResponse(stream(), media_type="text/event-stream")
# ----------------- GET ---------------------
# ---- Obtiene todos los chats ----
@chat_router.get("")
def get_all_chats(
    db: Session = Depends(get_db), 
    user: dict = Depends(get_current_user)
):
    try:
        chats = SidebarCache.get_chats(
            user_id=user["user_id"], 
            app_id=user["app_id"], 
            db_session=db
        )
        return chats
    except Exception as e:
        logger.exception("Error al obtener chats")
        raise HTTPException(status_code=500, detail=str(e))
        
# ---- Obtiene mensajes recientes de un chat específico ----
@chat_router.get("/{chat_id}/messages/recent")
def get_recent_messages(chat_id: UUID, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    owned = db.query(Chat.id).filter(
        Chat.id == chat_id, Chat.user_id == user["user_id"], Chat.app_id == user["app_id"]
    ).first()
    if not owned:
        raise HTTPException(status_code=404, detail='Chat no encontrado o acceso denegado')
    try:
        messages = ChatCache.get_messages(str(chat_id), db_session=db)
        return messages
    except Exception as e:
        logger.exception(f"Error en mensajes recientes de {chat_id}")
        raise HTTPException(status_code=500, detail=str(e))

# ---- Obtiene todos los mensajes de un chat específico ----
@chat_router.get("/{chat_id}/messages")
def get_chat_messages(chat_id: UUID, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    try:
        chat = db.query(Chat).filter(
            Chat.id == chat_id, 
            Chat.user_id == user["user_id"],
            Chat.app_id == user["app_id"]
        ).first()
        
        if not chat:
            raise HTTPException(status_code=404, detail='Chat no encontrado o acceso denegado')
        
        stmt = (select(Message)
                .where(Message.chat_id == chat_id, Message.role.in_(LLM_ROLES))
                .order_by(Message.created_at.asc()))
        messages = db.execute(stmt).scalars().all()
        
        return [{
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "created_at": msg.created_at.isoformat()
        } for msg in messages]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error al obtener mensajes del chat {chat_id}")
        raise HTTPException(status_code=500, detail=str(e))

    
# ----------------- DELETE -------------------
    
@chat_router.delete("/{chat_id}")
def delete_chat(chat_id: UUID, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    try:
        # 1. BUSCAMOS EL CHAT
        chat = db.query(Chat).filter(
            Chat.id == chat_id, 
            Chat.user_id == user["user_id"],
            Chat.app_id == user["app_id"]
        ).first()
        
        # 2. VALIDACIÓN
        if not chat:
            # HTTPException es el equivalente a jsonify() + status code en FastAPI
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="Chat no encontrado o acceso denegado"
            )

        # 3. ACCIÓN
        db.delete(chat)
        db.commit()
        
        # === AVISAR A REDIS ===
        SidebarCache.invalidate_user(user["user_id"], user["app_id"])
        logger.info(f"[Redis] Sidebar invalidado por eliminación de chat: {chat_id}")
        
        return {"message": "Chat eliminado correctamente"}

    except HTTPException:
        raise
    except Exception as e:
        # Si es un error inesperado (DB caída, error de sintaxis, etc.)
        db.rollback()
        logger.exception("Error al eliminar chat")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=str(e)
        )


# ----------------- POST ---------------------  
  
# ------------ POST (crear chat) ------------- 
       
@chat_router.post("", status_code=status.HTTP_201_CREATED)
def create_chat(
    payload: CreateChatRequest, 
    db: Session = Depends(get_db), 
    user: dict = Depends(get_current_user)
):
    try:
        # Validación de seguridad defensiva
        if not user or not user.get("user_id"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario no autenticado"
            )

        # 3. CREACIÓN DEL CHAT
        new_chat = Chat(
            user_id=user["user_id"], 
            app_id=user["app_id"],
            title=payload.title
        )
        
        db.add(new_chat)
        db.commit()
        db.refresh(new_chat)
        
        logger.debug(f"[DEBUG] Nuevo chat creado para: {user['user_id']}; ID del chat: {new_chat.id}; Título: {new_chat.title}")
        
        # 4. AVISAR A REDIS
        SidebarCache.invalidate_user(user["user_id"], user["app_id"])
        logger.info(f"CREATE: Chat {new_chat.id} vinculado a App: {user['app_id']}")
        
        # 5. RETORNAR DATA
        return {
            "id": new_chat.id,
            "title": new_chat.title,
            "created_at": new_chat.created_at.isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback() 
        logger.exception("Error al crear chat")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# --------------- POST (extraer texto de archivos) ---------------
# Función normal (fuera de la ruta) para la tarea en 2do plano
def background_task(file_bytes: bytes, filename_bd: str, content_type: str, user_id: str, text_to_store: str, filename_ui: str):
    user_events = event_queues[str(user_id)]
    bg_session = SessionLocal() # La tarea de fondo maneja su propia sesión
    try:
        access_token = get_user_onedrive_token(user_id)
        if not access_token:
            return  # OneDrive es opcional: sin cuenta vinculada no hay nada que subir

        user_events.put({"type": "upload_started", "filename": filename_ui, "user_id": str(user_id)})
        logger.info(f"Background upload started: {filename_ui}")

        download_url = upload_to_onedrive(access_token, filename_bd, file_bytes)

        document = Document(
            user_id=user_id, filename=filename_bd, content=text_to_store,
            mime_type=content_type, file_size=len(file_bytes),
            url=download_url, source="onedrive", tag="user_upload_mcp"
        )

        bg_session.add(document)
        bg_session.commit()

        user_events.put({"type": "upload_completed", "filename": filename_ui, "url": download_url, "user_id": str(user_id)})
    except Exception as e:
        bg_session.rollback()
        logger.exception("Background task error")
        user_events.put({"type": "upload_error", "filename": filename_ui, "error": str(e), "user_id": str(user_id)})
    finally:
        bg_session.close()


@chat_router.post("/extract_file")
async def extract_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    original_filename = file.filename
    original_name_base, ext = os.path.splitext(file.filename)
    timestamp = get_now().strftime("%Y%m%d_%H%M%S")
    filename = secure_filename(f"{original_name_base}_{timestamp}{ext}")

    content_type = file.content_type or ""
    file_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="El archivo supera los 10 MB")

    try:
        if content_type.startswith("image/"):
            final_text = await run_in_threadpool(analyze_image_with_azure, file_bytes, user_id=user["user_id"])
            logger.info(f"Text extracted from image {original_filename}")
            resp_text = f"Image '{original_filename}':\n\n{final_text}"
        else:
            final_text = await run_in_threadpool(extract_text_from_file, BytesIO(file_bytes), original_filename)
            resp_text = f"File content '{original_filename}':\n\n{final_text}"

        # Mandar la tarea a segundo plano. FastAPI se encarga de ejecutarla
        background_tasks.add_task(
            background_task,
            file_bytes, filename, content_type, user["user_id"], final_text, original_filename
        )

        return {
            "text": resp_text,
            "filename": original_filename,
            "status": "processing_bg"
        }

    except Exception as e:
        logger.exception("Error processing file")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

# --------------- PUT ---------------
@chat_router.put("/{chat_id}/title")
def update_chat_title(
    chat_id: UUID, 
    payload: UpdateTitleRequest, 
    db: Session = Depends(get_db), 
    user: dict = Depends(get_current_user)
):
    try:
        chat = db.query(Chat).filter(
            Chat.id == chat_id, Chat.user_id == user["user_id"], Chat.app_id == user["app_id"]
        ).first()
        
        if not chat:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acceso denegado")
        
        chat.title = payload.title
        db.commit()
        
        # === AVISAR A REDIS ===
        SidebarCache.invalidate_user(user["user_id"], user["app_id"])
        logger.info(f"[Redis] Sidebar invalidado por actualización de título del chat: {chat_id}")

        return {'message': 'Título actualizado', 'title': payload.title}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error actualizando título del chat")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
