import pytz
from datetime import datetime

TIMEZONE = pytz.timezone('America/Guayaquil')

def get_now():
    """Devuelve la hora actual de Ecuador con información de zona horaria."""
    return datetime.now(TIMEZONE)


DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
         "noviembre", "diciembre"]


def fecha_hora_texto(ahora: datetime | None = None) -> str:
    """'martes 03 de noviembre de 2026, 09:05' en español (strftime daba los nombres en inglés)."""
    ahora = ahora or get_now()
    return f"{DIAS[ahora.weekday()]} {ahora:%d} de {MESES[ahora.month - 1]} de {ahora.year}, {ahora:%H:%M}"