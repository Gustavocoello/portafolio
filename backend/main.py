import os
import uvicorn
import faulthandler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# Rutas v1
from src.api.v1.chat.routes import search_router, chat_router
from src.api.v1.auth.google_routes import google_auth_router
from src.api.v1.auth.onedrive_routes import onedrive_router
from src.api.v1.auth.user_routes import user_router, integrations_router

# Los routers v2 y de telemetría
from src.api.v2.chat.routes import chat_v2_router
from src.api.v2.security.routes import health_router
from dotenv import load_dotenv
from sqlalchemy import text
from src.database.settings.connection import Base, engine
import src.database.models.models  # noqa: F401 (registra las tablas en Base)

faulthandler.enable()

# Cargar las variables de entorno desde el archivo .env
load_dotenv()

PORT = int(os.getenv("PORT", 5000))
HOST = os.getenv("HOST", "0.0.0.0")
ENV = os.getenv("ENV", "").lower()

# shortcut: crea la extensión y las tablas que falten al arrancar, pero no altera columnas existentes;
# volver a Alembic cuando haya que cambiar el esquema con datos dentro
with engine.begin() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
Base.metadata.create_all(engine)

app = FastAPI(title="portafolio API")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://portafolio.brokeria.ec", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],  # Permite todos los métodos (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Permite todos los headers
)

# --- REGISTRO DE RUTAS ---
# Rutas v1
app.include_router(search_router, prefix='/api/v1/search')
app.include_router(chat_router, prefix='/api/v1/chat')
app.include_router(google_auth_router)
app.include_router(user_router)
app.include_router(onedrive_router)  # prefijo propio: /api/onedrive
app.include_router(integrations_router)  # prefijo propio: /api/v1/integrations

# Rutas v2
app.include_router(chat_v2_router, prefix="/api/v2/chat")
app.include_router(health_router)

if __name__ == "__main__":
    uvicorn.run(
        "main:app", 
        host=HOST, 
        port=PORT, 
        reload=(ENV == "dev"), 
        proxy_headers=True, 
        forwarded_allow_ips="*"
    )

# uvicorn main:app --reload --port 5000