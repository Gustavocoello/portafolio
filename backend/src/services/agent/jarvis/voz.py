"""Texto de la voz de TARS: su nombre como palabra de activación (como Alexa) y frases para hablar por partes."""
import re
import unicodedata

# "TARS", "Oye TARS", "Hey Tars, ..." al inicio de la frase; Whisper a veces escribe Tarz, Thars, Taz o Tarse
NOMBRE = re.compile(r"^\W*(?:(?:oye|hey|ey|hola|ok)\W+)?(?:tars|tarz|thars|tharz|tares|tarse|taz)\b\W*")


def quitar_nombre(texto: str) -> str | None:
    """Lo que viene después del nombre de TARS, o None si la frase no empieza con su nombre."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    m = NOMBRE.match(plano)
    if not m:
        return None
    # El texto plano pierde caracteres (¿, ¡, tildes): se avanza sobre el original hasta cubrir lo que ocupó el nombre
    contados = 0
    for i, letra in enumerate(texto):
        if contados >= m.end():
            return texto[i:].strip()
        contados += len(unicodedata.normalize("NFKD", letra).encode("ascii", "ignore").decode())
    return ""


# "TARS:", "TARS aquí.", "Soy TARS," al inicio de una respuesta: el nombre ya lo dijo Gustavo para llamarlo
NOMBRE_AL_RESPONDER = re.compile(r"^\s*(?:(?:soy|aqu[ií])\s+)?tars(?:\s+aqu[ií])?\s*[:,.!—-]+\s*", re.IGNORECASE)


def sin_nombre_al_inicio(texto: str) -> str:
    """La respuesta sin "TARS:" (u otra forma de presentarse) al principio."""
    resto = NOMBRE_AL_RESPONDER.sub("", texto, count=1)
    return (resto[:1].upper() + resto[1:]) if resto.strip() else texto


def frases(texto: str) -> list[str]:
    """Parte la respuesta en frases para que la primera suene mientras se generan las demás."""
    return [p for p in re.split(r"(?<=[.!?…])\s+", texto.strip()) if p.strip()]
