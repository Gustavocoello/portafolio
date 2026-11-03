"""Qué parte de la conversación va al modelo en cada mensaje."""
from langchain_core.messages import HumanMessage

# El hilo de TARS es uno solo para todas las sesiones de voz y crecía sin límite: cada pregunta reenviaba toda la
# conversación y Groq respondía 429/413 (límite de tokens por minuto), así que el router esperaba ~60 s.
# Al modelo solo van los últimos mensajes; la memoria guardada no se borra.
MAX_HISTORIAL = 20


def recortar_historial(mensajes: list, maximo: int = MAX_HISTORIAL) -> list:
    """Los últimos `maximo` mensajes, empezando siempre en un mensaje del usuario (nunca en un resultado de
    herramienta suelto, que el modelo rechaza sin la llamada que lo pidió)."""
    if len(mensajes) <= maximo:
        return mensajes
    recorte = mensajes[-maximo:]
    for i, m in enumerate(recorte):
        if isinstance(m, HumanMessage):
            return recorte[i:]
    # Un solo turno más largo que el máximo (muchas herramientas seguidas): desde la última pregunta del usuario
    for i in range(len(mensajes) - 1, -1, -1):
        if isinstance(mensajes[i], HumanMessage):
            return mensajes[i:]
    return recorte
