# Correr desde backend/:  python -m pytest tests
from email.message import EmailMessage

from src.services.agent.jarvis.tools import email as correo


class FakeIMAP:
    def __init__(self, mensajes):
        self.mensajes = mensajes  # uid -> bytes

    def uid(self, cmd, uid, query):
        if cmd == "search":
            return "OK", [b" ".join(self.mensajes)]
        assert "PEEK" in query  # nunca marcar como leído
        datos = self.mensajes.get(uid if isinstance(uid, bytes) else uid.encode())
        return "OK", [(b"", datos)] if datos else [None]

    def logout(self):
        pass


def _msg(asunto, de, cuerpo):
    m = EmailMessage()
    m["Subject"], m["From"], m["Date"] = asunto, de, "Mon, 02 Nov 2026 09:30:00 -0500"
    m.set_content(cuerpo)
    return m.as_bytes()


def test_pendientes_y_leer(monkeypatch):
    fake = FakeIMAP({b"7": _msg("Póliza vencida", "ana@x.ec", "Renovar hoy"), b"9": _msg("Hola", "b@x.ec", "Nada")})
    monkeypatch.setattr(correo, "_conectar", lambda: fake)
    lista = correo.correos_pendientes()
    assert lista.startswith("2 sin leer")
    assert lista.index("[9]") < lista.index("[7]")  # el más reciente primero
    assert "Póliza vencida" in lista
    assert "Renovar hoy" in correo.leer_correo("[7]")
    assert "No existe" in correo.leer_correo("99")
