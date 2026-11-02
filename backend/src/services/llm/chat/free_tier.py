# src/services/llm/chat/free_tier.py
from typing import Optional

from src.services.cache.redis_client import redis_client
from src.services.llm.chat.llm_router import completion

VISITOR_LIMIT = 10  # mensajes por visitante (IP o cuenta), en total
VISITOR_TTL = 30 * 86400  # shortcut: el conteo se reinicia a los 30 días; quitar el expire si debe ser para siempre


def generate_prompt(prompt_data):
    """Respuesta de una sola vuelta (sin memoria ni herramientas) para visitantes."""
    return completion([{"role": "user", "content": prompt_data.get("description", "")}])


def visitor_message_count(visitor: str) -> Optional[int]:
    """Suma un mensaje al visitante y devuelve su total. None si Redis no está disponible."""
    if not redis_client.is_available():
        return None
    key = f"visitor:messages:{visitor}"
    count = redis_client.client.incr(key)
    if count == 1:
        redis_client.client.expire(key, VISITOR_TTL)
    return count
