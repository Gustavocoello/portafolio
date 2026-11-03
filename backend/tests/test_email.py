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


def test_sin_leer_solo_baja_lo_nuevo(monkeypatch):
    fake = FakeIMAP({b"7": _msg("Siniestro", "ana@x.ec", "Choque"), b"9": _msg("Hola", "b@x.ec", "Nada")})
    pedidos = []
    original = fake.uid
    fake.uid = lambda cmd, uid, query: (pedidos.append((cmd, uid, query)), original(cmd, uid, query))[1]
    monkeypatch.setattr(correo, "_conectar", lambda: fake)

    uids, correos = correo.sin_leer(omitir={"9"})
    assert uids == ["9", "7"]
    assert [c["uid"] for c in correos] == ["7"] and correos[0]["texto"].startswith("Choque")
    assert [p[1] for p in pedidos if p[0] == "fetch"] == ["7"]  # el ya visto no se vuelve a bajar
    assert all("<0." in p[2] for p in pedidos if p[0] == "fetch")  # solo el inicio, sin adjuntos

    pedidos.clear()
    assert correo.sin_leer(solo_uids=True) == (["9", "7"], [])
    assert not [p for p in pedidos if p[0] == "fetch"]


class FakeBuzon:
    """IMAP con dos carpetas; registra lo que se pidió."""
    def __init__(self):
        self.carpetas = {"INBOX": {b"7": (_msg("Póliza", "ana@x.ec", "Renovar"), True), b"9": (_msg("Hola", "b@x.ec", "Nada"), False)},
                         "INBOX.Sent": {b"3": (_msg("Cotización", "yo@x.ec", "Adjunto"), True)}}
        self.actual, self.busquedas, self.literal = "INBOX", [], None

    def list(self):
        return "OK", [rb'(\HasNoChildren) "." "INBOX"', rb'(\HasNoChildren \Sent) "." INBOX.Sent']  # sin comillas, como lo da el servidor real

    def select(self, carpeta, readonly=False):
        self.actual = carpeta.strip('"')

    def uid(self, cmd, *args):
        mensajes = self.carpetas[self.actual]
        if cmd == "search":
            self.busquedas.append((args, self.literal))
            return "OK", [b" ".join(mensajes)]
        uid, query = args
        assert "PEEK" in query
        datos, visto = mensajes.get(uid if isinstance(uid, bytes) else uid.encode(), (None, False))
        if not datos:
            return "OK", [None]
        return "OK", [((rb"1 (UID 1 FLAGS (\Seen) BODY[]" if visto else b"1 (UID 1 FLAGS () BODY[]"), datos)]

    def logout(self):
        pass


def test_buscar_todo_el_buzon_y_enviados(monkeypatch):
    buzon = FakeBuzon()
    monkeypatch.setattr(correo, "_conectar", lambda: buzon)

    lista = correo.buscar_correos(texto="póliza", dias=30)
    assert lista.startswith("2 correos")
    assert "Póliza" in lista and "Hola" in lista
    assert "[9]" in lista and lista.count("(sin leer)") == 1  # leídos y no leídos
    args, literal = buzon.busquedas[-1]
    assert args[:2] == ("CHARSET", "UTF-8") and "SINCE" in args and literal == "póliza".encode()

    enviados = correo.buscar_correos(enviados=True)
    assert "[enviados:3]" in enviados and "Cotización" in enviados
    assert "Adjunto" in correo.leer_correo("[enviados:3]")
