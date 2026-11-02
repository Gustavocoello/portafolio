# Correr desde backend/:  python -m pytest tests
from types import SimpleNamespace

from src.services.auth.auth import auth_middleware
from src.services.llm.chat import free_tier


class FakeRedis:
    def __init__(self):
        self.datos, self.ttl = {}, {}

    def incr(self, key):
        self.datos[key] = self.datos.get(key, 0) + 1
        return self.datos[key]

    def expire(self, key, segundos):
        self.ttl[key] = segundos


def test_tope_de_visitante(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(free_tier, "redis_client", SimpleNamespace(is_available=lambda: True, client=fake))

    cuentas = [free_tier.visitor_message_count("ip:1.2.3.4") for _ in range(free_tier.VISITOR_LIMIT + 1)]
    assert cuentas[-1] > free_tier.VISITOR_LIMIT  # el mensaje 11 ya pasa el tope
    assert fake.ttl == {"visitor:messages:ip:1.2.3.4": free_tier.VISITOR_TTL}  # el TTL se pone una sola vez
    assert free_tier.visitor_message_count("ip:5.6.7.8") == 1  # cada IP lleva su cuenta


def test_sin_redis_no_cuenta(monkeypatch):
    monkeypatch.setattr(free_tier, "redis_client", SimpleNamespace(is_available=lambda: False))
    assert free_tier.visitor_message_count("ip:1.2.3.4") is None


def test_solo_el_dueno(monkeypatch):
    usuario = lambda email: {"user_obj": SimpleNamespace(email=email)}
    monkeypatch.setattr(auth_middleware, "OWNER_EMAIL", "dueno@x.ec")
    assert auth_middleware.es_dueno(usuario("Dueno@X.ec"))
    assert not auth_middleware.es_dueno(usuario("otro@x.ec"))
    monkeypatch.setattr(auth_middleware, "OWNER_EMAIL", "")  # sin OWNER_EMAIL nadie es dueño
    assert not auth_middleware.es_dueno(usuario(""))


def test_nombre_de_tars():
    from src.services.agent.jarvis.voz import quitar_nombre as _quitar_nombre
    assert _quitar_nombre("TARS, ¿qué tengo hoy en el calendario?") == "¿qué tengo hoy en el calendario?"
    assert _quitar_nombre("¡Oye, Tars! Léeme los correos.") == "Léeme los correos."
    assert _quitar_nombre("Hey Tarz qué hora es") == "qué hora es"
    assert _quitar_nombre("TARS.") == ""  # solo el nombre: queda escuchando
    assert _quitar_nombre("Gracias por ver el video") is None  # ruido o charla que no es para TARS
    assert _quitar_nombre("Le dije a Tars que no") is None  # el nombre tiene que ir al inicio
    assert _quitar_nombre("Tarsis es una ciudad") is None
