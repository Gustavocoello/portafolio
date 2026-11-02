from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from src.core.time_helper import get_now
from src.database.settings.connection import engine

health_router = APIRouter()


@health_router.get("/ping")
def ping():
    return {"status": "pong", "timestamp": get_now().isoformat()}


@health_router.get("/db-health")
def db_health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"status": "unhealthy", "error": str(e)})
    return {"status": "healthy"}
