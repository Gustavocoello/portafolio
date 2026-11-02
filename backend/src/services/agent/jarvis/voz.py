"""Texto de la voz de TARS: su nombre como palabra de activación (como Alexa) y frases para hablar por partes."""
import re
import unicodedata

# "TARS", "Oye TARS", "Hey Tars, ..." al inicio de la frase; Whisper a veces escribe Tarz o Thars
NOMBRE = re.compile(r"^\W*(?:(?:oye|hey|ey|hola|ok)\W+)?(?:tars|tarz|thars|tares)\b\W*")


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


def frases(texto: str) -> list[str]:
    """Parte la respuesta en frases para que la primera suene mientras se generan las demás."""
    return [p for p in re.split(r"(?<=[.!?…])\s+", texto.strip()) if p.strip()]
