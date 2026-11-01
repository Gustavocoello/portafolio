# backend/src/services/llm/chat/llm_router.py
import os
from dotenv import load_dotenv
from src.core.logging import get_logger

from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.language_models.chat_models import BaseChatModel

load_dotenv()
logger = get_logger("backend.engine.llm")

def get_cf_url(account_id):
    return f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"

API_PROVIDERS_TO_AGENT = [
    # ---- BLOQUE OPENROUTER
    {
        "name": "OPENROUTER - FREE 0",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER0",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 1",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER1",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 2",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER2",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 3",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER3",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 4",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER4",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 5",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER5",
        "model": "openrouter/free"
    },
    {
        "name": "OPENROUTER - FREE 6",
        "base_url": "https://openrouter.ai/api/v1",
        "key": "OPENROUTER6",
        "model": "openrouter/free"
    },
    # ---- BLOQUE GROQ
    # Mismas keys que el pool TARS del llm-router. Modelos vigentes a nov-2026
    # (GET /openai/v1/models): llama-3.x, qwen3-32b y kimi-k2 ya no existen.
    {
        "name": "Groq: GPT-OSS-20B",
        "base_url": "https://api.groq.com/openai/v1",
        "key": "GROQ_API_KEY0",
        "model": "openai/gpt-oss-20b"
    },
    {
        "name": "Groq: Qwen3.8-27B",
        "base_url": "https://api.groq.com/openai/v1",
        "key": "GROQ_API_KEY1",
        "model": "qwen/qwen3.8-27b"
    },
    {
        "name": "Groq: GPT-OSS-120B",
        "base_url": "https://api.groq.com/openai/v1",
        "key": "GROQ_API_KEY2",
        "model": "openai/gpt-oss-120b"
    },
    # ---- BLOQUE CLOUDFLARE
    {
        "name": "Cloudflare: Nodo-Alfa (Llama 3.1)",
        "base_url": "CLOUDFLARE_ID0",  # se resuelve dinámicamente con get_cf_url
        "key": "CLOUDFLARE_TOKEN0",
        "model": "@cf/meta/llama-3.1-8b-instruct"
    },
    {
        "name": "Cloudflare: Nodo-Beta (LLama 4.0 Scout)",
        "base_url": "CLOUDFLARE_ID1",
        "key": "CLOUDFLARE_TOKEN1",
        "model": "@cf/meta/llama-4-scout-17b-16e-instruct"
    },
    {
        "name": "Cloudflare: Nodo-Gamma (Qwen 3)",
        "base_url": "CLOUDFLARE_ID2",
        "key": "CLOUDFLARE_TOKEN2",
        "model": "@cf/qwen/qwen3-30b-a3b-fp8"
    },
    # ---- BLOQUE COHERE
    {
        "name": "Cohere: Command-R-Plus (Trial-0)",
        "base_url": "https://api.cohere.ai/compatibility/v1",  # se resuelve dinámicamente
        "key": "COHORE_API_KEY0",
        "model": "command-r-08-2024"
    },
    {
        "name": "Cohere: Command-R-Plus (Trial-1)",
        "base_url": "https://api.cohere.ai/compatibility/v1",
        "key": "COHORE_API_KEY1",
        "model": "command-r-plus-08-2024"
    },
    {
        "name": "Cohere: Command-R-Plus (Trial-2)",
        "base_url": "https://api.cohere.ai/compatibility/v1",
        "key": "COHORE_API_KEY2",
        "model": "command-r-plus-08-2024"
    },
    # ---- BLOQUE MISTRAL
    {
        "name": "Mistral: Pixtral-Large (Key-0)",
        "base_url": "https://api.mistral.ai/v1",
        "key": "MISTRA_KEY0",
        "model": "pixtral-large-latest"
    },
    {
        "name": "Mistral: Mistral-Small (Key-2)",
        "base_url": "https://api.mistral.ai/v1",
        "key": "MISTRA_KEY0",
        "model": "mistral-small-latest"
    },
    # ---- BLOQUE CEREBRAS
    {
        "name": "Cerebras api key 0",
        "base_url": "https://api.cerebras.ai/v1",
        "key": "CEREBRAS_KEY0",
        "model": "gpt-oss-120b"
    },
]

MAX_RETRIES = 3  # re-intentos antes de saltar al siguiente proveedor


def _resolve(prov):
    """Devuelve (api_key, base_url) del proveedor; None si falta en el .env."""
    api_key = os.getenv(prov.get("key", ""))
    base_url = prov["base_url"]
    if base_url.startswith("CLOUDFLARE_ID"):
        cf_id = os.getenv(base_url)
        base_url = get_cf_url(cf_id) if cf_id else None
    return api_key, base_url


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


def completion_stream(messages):
    """Generador de streaming usando API_PROVIDERS_TO_AGENT."""
    for prov, client in _clients():
        for attempt in range(MAX_RETRIES):
            logger.info(f"[STREAMING] Usando provider '{prov['name']}' (intento {attempt + 1})")
            sent = False
            try:
                resp = client.chat.completions.create(model=prov["model"], messages=messages, stream=True)
                for chunk in resp:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        sent = True
                        yield delta
                return
            except Exception as err:
                logger.error(f"[STREAMING] Provider '{prov['name']}' falló: {err}")
                # Reintentar después de mandar texto lo duplicaría en el cliente
                if sent:
                    raise

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