# src/services/llm/chat/free_tier.py
from typing import Optional

from src.services.cache.redis_client import redis_client
from src.services.llm.chat.llm_router import completion
from src.services.llm.prompts.system_prompt import SYSTEM_PROMPT

VISITOR_LIMIT = 10  # mensajes por visitante (IP o cuenta), en total
VISITOR_TTL = 30 * 86400  # shortcut: el conteo se reinicia a los 30 días; quitar el expire si debe ser para siempre
HISTORY_TURNS = 12  # mensajes previos del mismo chat que ve el visitante
HISTORY_CHARS = 4000  # tope por mensaje: el historial del modo anónimo lo manda el navegador


def clean_history(history) -> list[dict]:
    """Solo turnos user/assistant con texto, los últimos HISTORY_TURNS y recortados."""
    turns = [
        {"role": h.get("role"), "content": str(h.get("content") or "")[:HISTORY_CHARS]}
        for h in (history or [])
        if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content")
    ]
    return turns[-HISTORY_TURNS:]


def generate_prompt(prompt_data, history=None):
    """Respuesta para visitantes: sin herramientas ni memoria a largo plazo, pero con el hilo del mismo chat."""
    return completion([
        {"role": "system", "content": SYSTEM_PROMPT},
        *clean_history(history),
        {"role": "user", "content": prompt_data.get("description", "")},
    ])


def visitor_ip(request) -> str:
    """IP real del visitante. Detrás del túnel, request.client es cloudflared y todos compartirían el mismo tope."""
    # shortcut: se confía en CF-Connecting-IP porque el backend solo escucha en 127.0.0.1 y el túnel
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


def visitor_remaining(visitor: str) -> Optional[int]:
    """Mensajes gratis que le quedan al visitante, sin gastar uno. None si Redis no está disponible."""
    if not redis_client.is_available():
        return None
    return max(0, VISITOR_LIMIT - int(redis_client.client.get(f"visitor:messages:{visitor}") or 0))


def visitor_message_count(visitor: str) -> Optional[int]:
    """Suma un mensaje al visitante y devuelve su total. None si Redis no está disponible."""
    if not redis_client.is_available():
        return None
    key = f"visitor:messages:{visitor}"
    count = redis_client.client.incr(key)
    if count == 1:
        redis_client.client.expire(key, VISITOR_TTL)
    return count
