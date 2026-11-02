# src/database/settings/connection.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from src.core.logging import get_logger

logger = get_logger("backend.engine")

# Un solo Postgres (el del docker-compose). Formato: postgresql+psycopg2://user:pass@host:5432/db
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL, pool_size=5, max_overflow=10, pool_recycle=3600, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ==========================================
# CONFIGURACIONES ESPECÍFICAS PARA FASTAPI
# ==========================================

# 1. Base para los modelos
Base = declarative_base()

# 2. Inyección de dependencias para las rutas
def get_db():
    """
    Generador que crea una sesión de base de datos por cada petición HTTP
    y se asegura de cerrarla automáticamente al terminar.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()
