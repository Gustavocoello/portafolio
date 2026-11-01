# src/services/llm/chat/free_tier.py
from src.services.llm.chat.llm_router import completion


def generate_prompt(prompt_data):
    """Respuesta de una sola vuelta (sin memoria) para usuarios anónimos."""
    return completion([{"role": "user", "content": prompt_data.get("description", "")}])
