# ============================================================
# src/cache/redis_client.py
# ============================================================

import datetime
import os
import json
from uuid import UUID
from typing import Optional, Any
from dotenv import load_dotenv
import redis
from src.core.logging import get_logger

logger = get_logger('redis_client')

load_dotenv()

class RedisClient:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        self.url = os.getenv('REDIS_URL')  # redis://redis:6379/0 (el del docker-compose)
        self._available = False
        self.client = None

        if not self.url:
            logger.warning("REDIS_URL ausente: la caché queda desactivada.")
            return

        try:
            self.client = redis.Redis.from_url(self.url, decode_responses=True, socket_timeout=3)
            self.client.ping()
            self._available = True
            logger.info("Redis conectado")
        except Exception as e:
            logger.warning(f"Redis no disponible: {str(e)}")

    def is_available(self) -> bool:
        return self._available and self.client is not None
    
    def custom_serializer(self, obj: Any) -> str:
        """Maneja UUID y Datetime para JSON"""
        if isinstance(obj, UUID):
            return str(obj)
        # Importante: chequear explicitamente contra datetime.datetime
        if isinstance(obj, datetime.datetime):
            return obj.isoformat()
        raise TypeError(f"Type {type(obj)} not serializable")

    def get(self, key: str) -> Optional[dict]:
        if not self.is_available(): return None
        try:
            value = self.client.get(key)
            if not value: return None
            
            # Si Upstash devuelve un string, lo convertimos a dict
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value # Es un string plano
            return value
        except Exception as e:
            logger.error(f"Error GET {key}: {str(e)}")
            return None

    def set(self, key: str, value: Any, ttl: int = 3600) -> bool:
        """Guarda valores serializando UUIDs y fechas automáticamente."""
        if not self.is_available(): return False
        try:
            json_value = json.dumps(value, default=self.custom_serializer, ensure_ascii=False)
            self.client.set(key, json_value, ex=ttl)
            return True
        except Exception as e:
            logger.error(f"Error SET {key}: {str(e)}")
            return False

    def delete(self, key: str):
        if self.is_available():
            self.client.delete(key)
    
    def invalidate_pattern(self, pattern: str) -> bool:
        """Elimina todas las claves que coincidan con un patrón"""
        if not self.is_available(): return False
        
        try:
            keys = self.client.keys(pattern)
            if keys:
                self.client.delete(*keys)
                logger.info(f"Invalidadas {len(keys)} claves: {pattern}")
            return True
        except Exception as e:
            logger.error(f"Error invalidando {pattern}: {str(e)}")
            return False

# Singleton global
redis_client = RedisClient()