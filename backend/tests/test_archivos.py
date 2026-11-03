# Correr desde backend/:  python -m pytest tests
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "servers" / "mcp_servers" / "files"))
import archivos as srv  # noqa: E402  (el módulo del servidor de home-lab-laptop)

from src.services.agent.jarvis.tools import archivos as herramientas  # noqa: E402


@pytest.fixture
def raices(tmp_path, monkeypatch):
    vault, docs = tmp_path / "vault", tmp_path / "archivos"
    (vault / "10-Proyectos" / "TARS").mkdir(parents=True)
    (vault / "00-Inbox").mkdir()
    (vault / "graphify").mkdir()
    (vault / ".obsidian").mkdir()
    (vault / "10-Proyectos" / "TARS" / "TARS.md").write_text("---\ntags: [tipo/proyecto]\n---\n# TARS\nVoz en español\n", encoding="utf-8")
    docs.mkdir()
    (docs / "Póliza Ana.txt").write_text("Vence el 30 de noviembre", encoding="utf-8")
    monkeypatch.setenv("ARCHIVOS_RAICES", f"vault={vault},archivos={docs}")
    monkeypatch.setenv("ARCHIVOS_REGISTRO", str(tmp_path / "registro" / "cambios.jsonl"))
    return SimpleNamespace(vault=vault, docs=docs, registro=tmp_path / "registro" / "cambios.jsonl", tmp=tmp_path)


def test_no_sale_de_las_raices(raices):
    for mala in ["../etc/passwd", "vault/../../etc", "otra/x", "vault/.obsidian/app.json", ""]:
        with pytest.raises(srv.ErrorArchivos):
            srv.resolver(mala)


@pytest.mark.skipif(sys.platform == "win32", reason="enlaces simbólicos piden permisos en Windows")
def test_un_enlace_no_saca_de_las_raices(raices):
    afuera = raices.tmp / "secreto.txt"
    afuera.write_text("x")
    (raices.docs / "enlace").symlink_to(afuera)
    with pytest.raises(srv.ErrorArchivos, match="sale"):
        srv.leer("archivos/enlace")


def test_listar_buscar_y_leer(raices):
    assert "vault/" in srv.listar() and "archivos/" in srv.listar()
    lista = srv.listar("vault")
    assert "10-Proyectos/" in lista and ".obsidian" not in lista
    assert "archivos/Póliza Ana.txt" in srv.buscar("poliza")  # sin tildes ni mayúsculas
    assert "Nada" in srv.buscar("noviembre")
    assert "archivos/Póliza Ana.txt" in srv.buscar("noviembre", en_contenido=True)
    (raices.vault / "graphify" / "tarsMapa().md").write_text("x", encoding="utf-8")
    (raices.vault / "00-Inbox" / "tars.sync-conflict-20261103.md").write_text("x", encoding="utf-8")
    assert srv.buscar("tars").splitlines()[1:] == ["vault/10-Proyectos/TARS/TARS.md"]  # sin graphify ni conflictos
    assert "Voz en español" in srv.leer("vault/10-Proyectos/TARS/TARS.md")


def test_leer_por_partes(raices, monkeypatch):
    monkeypatch.setattr(srv, "MAX_LEER", 10)
    (raices.docs / "largo.txt").write_text("a" * 25, encoding="utf-8")
    assert "desde=10" in srv.leer("archivos/largo.txt")
    assert "continúa" not in srv.leer("archivos/largo.txt", desde=20)


def test_crear_en_el_vault_pone_frontmatter_y_registra(raices):
    assert srv.crear("vault/00-Inbox/idea.md", "Probar [[TARS]] con voz", simular=True).startswith("Crear")
    assert not (raices.vault / "00-Inbox" / "idea.md").exists()  # simular no toca nada
    srv.crear("vault/00-Inbox/idea.md", "Probar [[TARS]] con voz")
    texto = (raices.vault / "00-Inbox" / "idea.md").read_text(encoding="utf-8")
    assert texto.startswith("---\ntags: [tipo/idea]\ncreated: ") and "status: activo" in texto
    linea = json.loads(raices.registro.read_text(encoding="utf-8").splitlines()[-1])
    assert linea["accion"] == "crear" and linea["ruta"] == "vault/00-Inbox/idea.md"
    with pytest.raises(srv.ErrorArchivos, match="no se sobrescribe"):
        srv.crear("vault/00-Inbox/idea.md", "otra")


def test_reglas_del_vault(raices):
    with pytest.raises(srv.ErrorArchivos, match="graphify"):
        srv.crear("vault/graphify/x.md", "hola")
    for sensible in ["password: hunter22", "key sk-abcdefghijklmnop1234", "escribir a ana@x.ec", "llamar al 0991234567"]:
        with pytest.raises(srv.ErrorArchivos, match="contraseñas"):
            srv.anotar("vault/10-Proyectos/TARS/TARS.md", sensible)
    srv.anotar("vault/10-Proyectos/TARS/TARS.md", "- 2026-11-03 — Decisión con fecha. **Por qué:** prueba")
    assert "Decisión con fecha" in (raices.vault / "10-Proyectos" / "TARS" / "TARS.md").read_text(encoding="utf-8")
    # En archivos/ no aplica la regla del vault
    (raices.docs / "contactos.txt").write_text("", encoding="utf-8")
    srv.anotar("archivos/contactos.txt", "ana@x.ec")


def test_mover_y_papelera_nunca_borran(raices):
    (raices.docs / "Clientes").mkdir()
    srv.mover("archivos/Póliza Ana.txt", "archivos/Clientes")
    assert (raices.docs / "Clientes" / "Póliza Ana.txt").exists()
    (raices.docs / "otra.txt").write_text("x")
    with pytest.raises(srv.ErrorArchivos, match="no se sobrescribe"):
        srv.mover("archivos/otra.txt", "archivos/Clientes/Póliza Ana.txt")
    respuesta = srv.papelera("archivos/otra.txt")
    assert "Papelera" in respuesta and not (raices.docs / "otra.txt").exists()
    assert len(list((raices.docs / "Papelera").iterdir())) == 1
    assert "Nada" in srv.buscar("otra")  # la Papelera no aparece en las búsquedas


# ─── Laptop Windows: código solo de lectura, secretos y carpetas generadas ──────

@pytest.fixture
def laptop(tmp_path, monkeypatch):
    work, descargas = tmp_path / "work", tmp_path / "descargas"
    (work / "repo" / "node_modules" / "lib").mkdir(parents=True)
    (work / "repo" / "node_modules" / "lib" / "poliza.js").write_text("x", encoding="utf-8")
    (work / "repo" / "poliza.py").write_text("print('poliza')", encoding="utf-8")
    (work / "repo" / "credentials.json").write_text('{"poliza": "clave"}', encoding="utf-8")
    (work / "repo" / ".env").write_text("KEY=poliza", encoding="utf-8")
    (work / "Data").mkdir()
    (work / "Data" / "poliza.csv").write_text("a,b", encoding="utf-8")
    descargas.mkdir()
    monkeypatch.setenv("ARCHIVOS_RAICES", f"work={work},datos={work / 'Data'},descargas={descargas}")
    monkeypatch.setenv("ARCHIVOS_SOLO_LECTURA", "work")
    monkeypatch.setenv("ARCHIVOS_REGISTRO", str(tmp_path / "registro" / "cambios.jsonl"))
    return SimpleNamespace(work=work, descargas=descargas)


def test_work_solo_se_lee(laptop):
    assert "print" in srv.leer("work/repo/poliza.py")
    for cambio in [lambda: srv.crear("work/repo/nota.md", "x"), lambda: srv.papelera("work/repo/poliza.py"),
                   lambda: srv.mover("work/repo/poliza.py", "descargas/poliza.py"),
                   lambda: srv.mover("datos/poliza.csv", "work/repo/poliza.csv")]:
        with pytest.raises(srv.ErrorArchivos, match="solo de lectura"):
            cambio()
    assert srv.crear("descargas/nota.md", "hola").startswith("Creado")  # las demás carpetas sí se escriben


def test_secretos_y_ruido_fuera(laptop):
    with pytest.raises(srv.ErrorArchivos, match="secretos"):
        srv.leer("work/repo/credentials.json")
    with pytest.raises(srv.ErrorArchivos):
        srv.leer("work/repo/.env")
    (laptop.work / "Data" / "pass.md").write_text("x", encoding="utf-8")
    with pytest.raises(srv.ErrorArchivos, match="secretos"):
        srv.leer("datos/pass.md")
    # nombres normales que se parecen sí se leen
    for nombre in ["passport.pdf", "compass.md", "Póliza Ana.txt"]:
        assert not srv._es_secreto(Path(nombre)), nombre
    hallados = srv.buscar("poliza", en_contenido=True).splitlines()[1:]
    # sin node_modules, sin mirar dentro de credentials.json ni .env, y Data una sola vez (como datos/)
    assert sorted(h.split(" — ")[0] for h in hallados) == ["datos/poliza.csv", "work/repo/poliza.py"]


# ─── Backend: confirmación en dos turnos ──────────────────────────────────────

@pytest.fixture
def tools(raices, monkeypatch):
    """Herramientas del backend contra el módulo del servidor, sin red."""
    herramientas._pendientes.clear()
    herramientas._ultimo_uso.clear()

    def llamar(user_id, nombre, args, equipo="homelab"):
        herramientas._ultimo_uso[user_id] = 0  # que la prueba de "uso reciente" no dependa de esto
        try:
            return getattr(srv, nombre.removeprefix("archivos_"))(**args)
        except srv.ErrorArchivos as e:
            return f"Error: {e}"

    monkeypatch.setattr(herramientas, "_llamar", llamar)
    return {t.name: t for t in herramientas.build_archivos_tools("u1")}


def _turno(n):
    return {"configurable": {"turno": f"t{n}"}}


def test_cambio_solo_con_un_si_en_otro_turno(raices, tools):
    proponer, confirmar = tools["archivos_proponer_cambio"], tools["archivos_confirmar_cambio"]
    assert "config" not in proponer.args  # el modelo no ve ni llena el turno
    r = proponer.invoke({"accion": "crear", "ruta": "vault/00-Inbox/nota.md", "contenido": "hola"}, config=_turno(1))
    assert r.startswith("Pendiente") and not (raices.vault / "00-Inbox" / "nota.md").exists()
    assert "Todavía no" in confirmar.invoke({}, config=_turno(1))  # mismo turno: no se hace
    assert not (raices.vault / "00-Inbox" / "nota.md").exists()
    assert confirmar.invoke({}, config=_turno(2)).startswith("Creado")
    assert (raices.vault / "00-Inbox" / "nota.md").exists()
    assert "No hay" in confirmar.invoke({}, config=_turno(3))  # no se repite


def test_propuesta_invalida_no_queda_pendiente(raices, tools):
    r = tools["archivos_proponer_cambio"].invoke({"accion": "mover", "ruta": "archivos/no-existe.txt",
                                                  "destino": "archivos/x.txt"}, config=_turno(1))
    assert r.startswith("Error") and "u1" not in herramientas._pendientes


def test_cancelar_y_vencer(raices, tools, monkeypatch):
    proponer, confirmar = tools["archivos_proponer_cambio"], tools["archivos_confirmar_cambio"]
    proponer.invoke({"accion": "papelera", "ruta": "archivos/Póliza Ana.txt"}, config=_turno(1))
    assert "Cancelado" in tools["archivos_cancelar_cambio"].invoke({})
    assert "No hay" in confirmar.invoke({}, config=_turno(2))
    proponer.invoke({"accion": "papelera", "ruta": "archivos/Póliza Ana.txt"}, config=_turno(3))
    herramientas._pendientes["u1"]["hora"] -= herramientas.VIGENCIA_PENDIENTE + 1
    assert "venció" in confirmar.invoke({}, config=_turno(4))
    assert (raices.docs / "Póliza Ana.txt").exists()


def test_carga_las_herramientas_solo_cuando_hacen_falta():
    herramientas._pendientes.clear()
    herramientas._ultimo_uso.clear()
    assert not herramientas.necesita_archivos("¿Qué tengo hoy en el calendario?", "u2")
    assert not herramientas.necesita_archivos("¿Cuántos correos sin leer tengo?", "u2")
    for pedido in ["Busca el PDF de la póliza", "Anótalo en el vault", "¿qué hay en la carpeta Descargas?",
                   "Mueve ese documento", "Lee mi nota de TARS"]:
        assert herramientas.necesita_archivos(pedido, "u2"), pedido
    herramientas._pendientes["u2"] = {}
    assert herramientas.necesita_archivos("sí", "u2")  # la respuesta a una propuesta no lleva palabras clave


def test_cada_ruta_va_a_su_equipo(monkeypatch):
    herramientas._pendientes.clear()
    monkeypatch.setenv("MCP_ARCHIVOS", "http://homelab")
    monkeypatch.setenv("MCP_ARCHIVOS_LAPTOP", "http://laptop")
    llamadas = []

    def llamar(user_id, nombre, args, equipo="homelab"):
        llamadas.append((nombre, equipo))
        return "Error: apagada" if equipo == "laptop" else "ok"

    monkeypatch.setattr(herramientas, "_llamar", llamar)
    t = {x.name: x for x in herramientas.build_archivos_tools("u3")}
    t["archivos_leer"].invoke({"ruta": "descargas/factura.pdf"})
    t["archivos_leer"].invoke({"ruta": "vault/00-Inbox/x.md"})
    t["archivos_leer"].invoke({"ruta": r"work\repo\a.py"})
    assert [e for _, e in llamadas] == ["laptop", "homelab", "laptop"]
    llamadas.clear()
    r = t["archivos_listar"].invoke({"ruta": ""})  # la raíz pregunta a los dos; la laptop apagada no tapa al otro
    assert sorted(e for _, e in llamadas) == ["homelab", "laptop"]
    assert "En home-lab-laptop: ok" in r and "En la laptop Windows: Error" in r
    r = t["archivos_proponer_cambio"].invoke({"accion": "mover", "ruta": "vault/a.md", "destino": "descargas/a.md"},
                                             config=_turno(1))
    assert r.startswith("Error") and "u3" not in herramientas._pendientes
    monkeypatch.delenv("MCP_ARCHIVOS_LAPTOP")
    llamadas.clear()
    t["archivos_leer"].invoke({"ruta": "descargas/factura.pdf"})  # sin laptop configurada, todo va a home-lab
    assert llamadas == [("archivos_leer", "homelab")]
