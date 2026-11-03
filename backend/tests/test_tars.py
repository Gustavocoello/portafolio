# Correr desde backend/:  python -m pytest tests
from datetime import datetime

from src.core.time_helper import TIMEZONE
from src.services.agent.jarvis.notices import eventos_por_empezar
from src.services.agent.jarvis.voz import frases

AGENDA = """Resumen de eventos para hoy (02/11/2026) - Hora Ecuador (GMT-5):

[Trabajo]:
• 02/11/2026 de 09:30 a 10:00: Reunión con Ana en Oficina
• 02/11/2026 de 15:00 a 16:00: Renovación póliza Pérez"""


def test_eventos_por_empezar():
    a_las = lambda h, m: TIMEZONE.localize(datetime(2026, 11, 2, h, m))
    assert eventos_por_empezar(AGENDA, a_las(9, 22)) == [("09:30", "Reunión con Ana en Oficina")]
    assert eventos_por_empezar(AGENDA, a_las(9, 10)) == []   # falta más de 10 minutos
    assert eventos_por_empezar(AGENDA, a_las(9, 31)) == []   # ya empezó
    assert eventos_por_empezar("[Trabajo] Sin eventos.", a_las(9, 22)) == []


def test_frases():
    assert frases("Tienes dos correos. Uno es de Ana… ¿Lo leo? Sí.") == ["Tienes dos correos.", "Uno es de Ana…", "¿Lo leo?", "Sí."]
    assert frases("  ") == []


def test_nombre_mal_escrito_por_whisper():
    from src.services.agent.jarvis.voz import quitar_nombre
    assert quitar_nombre("Taz, ¿qué hora es?") == "¿qué hora es?"
    assert quitar_nombre("Oye tarse, lee mis correos") == "lee mis correos"
    assert quitar_nombre("Tasa de interés del banco") is None


def test_hora_en_espanol_y_al_momento():
    from datetime import datetime
    from src.core.time_helper import fecha_hora_texto, TIMEZONE
    assert fecha_hora_texto(TIMEZONE.localize(datetime(2026, 11, 3, 9, 5))) == "martes 03 de noviembre de 2026, 09:05"


def test_al_modelo_va_solo_el_final_del_hilo():
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    from src.services.agent.common.historial import recortar_historial
    hilo = []
    for i in range(30):  # 30 turnos: pregunta, llamada a herramienta, resultado y respuesta
        hilo += [HumanMessage(f"p{i}"), AIMessage("", tool_calls=[{"name": "t", "args": {}, "id": f"c{i}"}]),
                 ToolMessage("r", tool_call_id=f"c{i}"), AIMessage(f"r{i}")]
    corto = recortar_historial(hilo)
    assert len(corto) <= 20 and isinstance(corto[0], HumanMessage) and corto[-1].content == "r29"
    assert recortar_historial(hilo[:8]) == hilo[:8]
