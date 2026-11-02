# backend/src/services/llm/chat/llm_router.py
import os
from dotenv import load_dotenv
from src.core.logging import get_logger

from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.language_models.chat_models import BaseChatModel

load_dotenv()
logger = get_logger("backend.engine.llm")

# Todo pasa por el llm-router de Oracle con el pool "tars": keys de Groq propias (3 cuentas),
# separadas de las de los brokers. El router rota las keys y reintenta; aquí no hay nada más.
API_PROVIDERS_TO_AGENT = [
    {
        "name": "llm-router (Oracle, pool tars)",
        "base_url": os.getenv("LLM_ROUTER_URL", "http://129.158.233.162:8001/v1"),
        "key": "LLM_ROUTER_KEY",
        "model": "tars"
    },
]

MAX_RETRIES = 3  # re-intentos antes de saltar al siguiente proveedor


def _resolve(prov):
    """Devuelve (api_key, base_url) del proveedor; la key es None si falta en el .env."""
    return os.getenv(prov.get("key", "")), prov["base_url"]


def _clients():
    """Recorre los proveedores configurados en orden, desde el primero en cada llamada."""
    for prov in API_PROVIDERS_TO_AGENT:
        api_key, base_url = _resolve(prov)
        if api_key and base_url:
            yield prov, OpenAI(base_url=base_url, api_key=api_key)


def completion(messages):
    """Llama a la API con rotación automática usando API_PROVIDERS_TO_AGENT."""
    for prov, client in _clients():
        for attempt in range(MAX_RETRIES):
            logger.info(f"Usando provider '{prov['name']}' (intento {attempt + 1})")
            try:
                resp = client.chat.completions.create(model=prov["model"], messages=messages)
                return resp.choices[0].message.content.strip()
            except Exception as err:
                logger.error(f"Provider '{prov['name']}' falló: {err}")

    raise RuntimeError("Todos los proveedores fallaron ─ intenta más tarde.")


# Agentes

def get_langchain_llm(temperature: int = 0) -> BaseChatModel:
    """
    Itera API_PROVIDERS_TO_AGENT, construye todos los válidos
    y devuelve una cascada de fallbacks (Plan A → Plan B → Plan C).
    """
    valid_llms = []

    for prov in API_PROVIDERS_TO_AGENT:
        # Resolver la key
        api_key, base_url = _resolve(prov)
        if not api_key or not base_url:
            continue

        try:
            llm = ChatOpenAI(
                base_url=base_url,
                api_key=api_key,
                model=prov["model"],
                temperature=temperature,
                max_retries=MAX_RETRIES
            )
            valid_llms.append(llm)
        except Exception:
            continue

    if not valid_llms:
        raise RuntimeError("No hay providers LLM disponibles para LangChain")

    primary = valid_llms[0]
    fallbacks = valid_llms[1:]

    if fallbacks:
        logger.info(f"LLM Principal: {primary.__class__.__name__}. Configuradas {len(fallbacks)} rutas de escape.")
        return primary.with_fallbacks(fallbacks)

    return primary