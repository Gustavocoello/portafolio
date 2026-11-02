import os
import requests
from sqlalchemy import select
from datetime import timedelta, timezone

from src.core.logging import get_logger
from src.core.time_helper import get_now
from src.database.models.models import UserToken
from src.database.settings.connection import SessionLocal
from src.services.auth.utils.token_crypto import encrypt_token, decrypt_token
from cryptography.fernet import InvalidToken
from dotenv import load_dotenv

logger = get_logger(__name__)
load_dotenv()

CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

SCOPE = "https://graph.microsoft.com/.default"

# ==========================================
# 1. SUBIR ARCHIVO A ONEDRIVE
# ==========================================
def upload_to_onedrive(access_token: str, filename: str, file_bytes: bytes) -> str:
    """
    Sube un archivo a OneDrive.
    Esta función es sincrónica, pero es segura porque FastAPI la ejecuta 
    dentro de un BackgroundTask (Threadpool) sin bloquear el servidor.
    """
    url = f"https://graph.microsoft.com/v1.0/me/drive/root:/Datos adjuntos/Work/Personal_Projects/MCP-Nexus/2025/{filename}:/content"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream"
    }
    
    resp = requests.put(url, headers=headers, data=file_bytes)
    
    if resp.status_code in [200, 201]:
        return resp.json()["@microsoft.graph.downloadUrl"]
    else:
        logger.error(f"OneDrive upload failed: {resp.text}")
        raise Exception(f"OneDrive upload failed: {resp.status_code}")


# ==========================================
# 2. TOKEN DE USUARIO (Delegated)
# ==========================================
def get_user_onedrive_token(user_id: str) -> str | None:
    """
    Obtiene el token de acceso de un usuario, refrescándolo si es necesario.
    Devuelve None si el usuario no vinculó OneDrive.
    Maneja su propia db_session porque puede ser llamado desde hilos en segundo plano.
    """
    db_session = SessionLocal()
    try:
        stmt = select(UserToken).filter_by(user_id=user_id, provider="onedrive")
        user_token = db_session.execute(stmt).scalar_one_or_none()
        
        if not user_token:
            return None

        try:
            access_token = decrypt_token(user_token.access_token)
            refresh_token = decrypt_token(user_token.refresh_token) if user_token.refresh_token else None
        except InvalidToken:
            # Tokens guardados en texto plano antes de cifrarlos: hay que volver a vincular
            logger.warning(f"Token de OneDrive sin cifrar para {user_id}; requiere volver a vincular")
            return None

        now = get_now()
        
        # Si expiró o está a punto de expirar (margen de 1 minuto)
        if user_token.expires_at and user_token.expires_at.replace(tzinfo=timezone.utc) < now + timedelta(minutes=1):
            logger.info(f"Refrescando token de OneDrive para usuario: {user_id}")
            
            data = {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": SCOPE
            }
            
            resp = requests.post("https://login.microsoftonline.com/common/oauth2/v2.0/token", data=data)
            
            if resp.status_code == 200:
                token_data = resp.json()
                access_token = token_data["access_token"]
                user_token.access_token = encrypt_token(access_token)
                
                if "refresh_token" in token_data:
                    user_token.refresh_token = encrypt_token(token_data["refresh_token"])
                
                # Guardar nueva expiración
                expires_in = token_data.get("expires_in", 3600)
                user_token.expires_at = now + timedelta(seconds=expires_in)
                
                db_session.add(user_token)
                db_session.commit()
            else:
                logger.error(f"Error al refrescar token OneDrive: {resp.text}")
                raise Exception("Sesión de OneDrive expirada. Por favor, vincula tu cuenta de nuevo.")

        return access_token

    except Exception as e:
        db_session.rollback()
        raise e
    finally:
        db_session.close()