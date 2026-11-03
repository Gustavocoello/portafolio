"""Archivos y vault de home-lab-laptop para TARS y Jarvis.

Reglas que no dependen del modelo:
- Solo se tocan las carpetas de ARCHIVOS_RAICES; las rutas son "raíz/sub/carpeta/archivo" ("vault/00-Inbox/x.md").
- Nunca se borra: "papelera" mueve a <raíz>/Papelera. Ningún cambio sobrescribe un archivo.
- Cada cambio queda en el registro (una línea JSON por cambio).
- En el vault: frontmatter obligatorio, nada de contraseñas, keys ni datos de contacto, y no se escribe en graphify/,
  _meta/ ni 40-Archivo/ (reglas del CLAUDE.md del vault).
La confirmación por voz la exige el backend (propone primero, ejecuta en el turno siguiente); aquí cada cambio
acepta simular=True para validarlo sin hacerlo.
"""
import json
import os
import re
import shutil
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

ZONA = timezone(timedelta(hours=-5), "Ecuador")  # sin horario de verano; no depende de tzdata
PAPELERA = "Papelera"
TEXTO = {".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".log", ".html", ".xml", ".py", ".sh", ".toml", ".ini"}
EDITABLES = {".md", ".txt", ".csv"}
VAULT_PROTEGIDO = ("graphify", "_meta", "40-Archivo")
MAX_LEER = 6000
MAX_ESCANEO = 20000  # archivos revisados por búsqueda, para que una búsqueda nunca tarde minutos

# Lo que no puede quedar en el vault (regla 8): keys, contraseñas y datos de contacto
SENSIBLE = [
    (re.compile(r"\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}"), "una API key"),
    (re.compile(r"\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}"), "un token de GitHub"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "una key de AWS"),
    (re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{10,}"), "un token de Slack"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."), "un token"),
    (re.compile(r"(contraseña|password|passwd)\s*[:=]\s*\S+", re.I), "una contraseña"),
    (re.compile(r"(api[_ -]?key|secret|token)\s*[:=]\s*\S{8,}", re.I), "una key"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "un correo"),
    # Solo formatos de teléfono (+593..., 09xxxxxxxx, fijo 0X XXX XXXX): las fechas 2026-11-03 no deben caer aquí
    (re.compile(r"\+\d{1,3}[ -]?\d[\d -]{6,}\d|\b09\d{8}\b|\b0[2-7][ -]?\d{3}[ -]?\d{4}\b"), "un teléfono"),
]


class ErrorArchivos(Exception):
    """Error que se le explica tal cual al usuario."""


def raices() -> dict[str, Path]:
    texto = os.getenv("ARCHIVOS_RAICES", "vault=/datos/vault,archivos=/datos/archivos")
    salida = {}
    for par in texto.split(","):
        nombre, _, ruta = par.strip().partition("=")
        if nombre and ruta:
            salida[nombre.strip()] = Path(ruta.strip())
    return salida


def _registro() -> Path:
    return Path(os.getenv("ARCHIVOS_REGISTRO", "/datos/registro/cambios.jsonl"))


def _ahora() -> datetime:
    return datetime.now(ZONA)


def _sin_tildes(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.casefold()) if unicodedata.category(c) != "Mn")


def resolver(ruta: str) -> tuple[str, Path, Path]:
    """'vault/00-Inbox/x.md' -> (nombre de la raíz, carpeta raíz, ruta real). Falla fuera de las raíces."""
    partes = [p for p in ruta.replace("\\", "/").strip().strip("/").split("/") if p not in ("", ".")]
    todas = raices()
    if not partes:
        raise ErrorArchivos(f"Falta la ruta. Carpetas disponibles: {', '.join(todas)}.")
    nombre = partes[0]
    if nombre not in todas:
        raise ErrorArchivos(f"'{nombre}' no es una carpeta permitida. Disponibles: {', '.join(todas)}.")
    if any(p == ".." or p.startswith(".") for p in partes[1:]):
        raise ErrorArchivos("No se permiten rutas con '..' ni carpetas ocultas.")
    raiz = todas[nombre].resolve()
    real = raiz.joinpath(*partes[1:]).resolve()
    if real != raiz and raiz not in real.parents:  # un enlace simbólico que sale de la raíz
        raise ErrorArchivos("Esa ruta sale de las carpetas permitidas.")
    return nombre, raiz, real


def _mostrar(nombre: str, raiz: Path, real: Path) -> str:
    rel = real.relative_to(raiz).as_posix()
    return nombre if rel == "." else f"{nombre}/{rel}"


def _tam(n: int) -> str:
    for unidad in ("B", "KB", "MB", "GB"):
        if n < 1024 or unidad == "GB":
            return f"{n:.0f} {unidad}" if unidad == "B" else f"{n:.1f} {unidad}"
        n /= 1024


def _registrar(accion: str, **datos) -> None:
    archivo = _registro()
    archivo.parent.mkdir(parents=True, exist_ok=True)
    with archivo.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"hora": _ahora().isoformat(timespec="seconds"), "accion": accion, **datos},
                           ensure_ascii=False) + "\n")


def _puede_escribir(nombre: str, raiz: Path, real: Path) -> None:
    rel = real.relative_to(raiz).parts
    if nombre == "vault" and rel and rel[0] in VAULT_PROTEGIDO:
        raise ErrorArchivos(f"En el vault no se escribe en {rel[0]}/ (regla del vault). Elige otra carpeta.")
    if real == raiz:
        raise ErrorArchivos("No se puede cambiar la carpeta raíz.")


def _revisar_texto(nombre: str, texto: str) -> None:
    if nombre != "vault":
        return
    for patron, que in SENSIBLE:
        if patron.search(texto):
            raise ErrorArchivos(f"El texto parece tener {que}; en el vault no se guardan contraseñas, keys ni "
                                "datos de contacto. Quítalo y vuelve a intentarlo.")


def _frontmatter(texto: str) -> str:
    """El vault exige tags, created y status; si la nota no los trae, se agregan por defecto."""
    if texto.lstrip().startswith("---"):
        return texto
    hoy = _ahora().date().isoformat()
    return f"---\ntags: [tipo/idea]\ncreated: {hoy}\nstatus: activo\n---\n\n{texto.lstrip()}"


# ─── Lectura ──────────────────────────────────────────────────────────────────

def listar(ruta: str = "") -> str:
    if not ruta.strip().strip("/"):
        return "Carpetas disponibles: " + ", ".join(f"{n}/" for n in raices())
    nombre, raiz, real = resolver(ruta)
    if not real.is_dir():
        raise ErrorArchivos(f"No existe la carpeta {ruta}.")
    entradas = sorted((e for e in real.iterdir() if not e.name.startswith(".")),
                      key=lambda e: (not e.is_dir(), e.name.casefold()))
    lineas = []
    for e in entradas[:100]:
        if e.is_dir():
            lineas.append(f"{e.name}/")
        else:
            st = e.stat()
            fecha = datetime.fromtimestamp(st.st_mtime, ZONA).date().isoformat()
            lineas.append(f"{e.name} ({_tam(st.st_size)}, {fecha})")
    titulo = f"{_mostrar(nombre, raiz, real)}: {len(entradas)} elementos"
    if len(entradas) > 100:
        titulo += " (se muestran 100)"
    return titulo + ("\n" + "\n".join(lineas) if lineas else "\n(vacía)")


def buscar(texto: str, ruta: str = "", en_contenido: bool = False, limite: int = 20) -> str:
    """Por nombre (sin importar tildes ni mayúsculas); con en_contenido también dentro de archivos de texto."""
    buscado = _sin_tildes(texto.strip())
    if not buscado:
        raise ErrorArchivos("Falta qué buscar.")
    lugares = [resolver(ruta)] if ruta.strip().strip("/") else [(n, p.resolve(), p.resolve()) for n, p in raices().items()]
    hallados, revisados = [], 0
    for nombre, raiz, inicio in lugares:
        if not inicio.is_dir():
            continue
        for carpeta, subcarpetas, archivos in os.walk(inicio):
            # graphify/ son mapas de código generados (miles de notas): solo ruido para una búsqueda
            omitir = {PAPELERA, "graphify"} if nombre == "vault" and Path(carpeta) == raiz else {PAPELERA}
            subcarpetas[:] = [s for s in subcarpetas if not s.startswith(".") and s not in omitir]
            for a in archivos:
                if a.startswith(".") or ".sync-conflict-" in a:
                    continue
                revisados += 1
                p = Path(carpeta) / a
                motivo = None
                if buscado in _sin_tildes(a):
                    motivo = "nombre"
                elif en_contenido and p.suffix.lower() in TEXTO and p.stat().st_size < 1_000_000:
                    contenido = p.read_text(encoding="utf-8", errors="ignore")
                    i = _sin_tildes(contenido).find(buscado)
                    if i >= 0:
                        motivo = "…" + " ".join(contenido[max(0, i - 60): i + 80].split()) + "…"
                if motivo:
                    hallados.append(_mostrar(nombre, raiz, p) + ("" if motivo == "nombre" else f" — {motivo}"))
                if len(hallados) >= limite or revisados >= MAX_ESCANEO:
                    break
            if len(hallados) >= limite or revisados >= MAX_ESCANEO:
                break
    if not hallados:
        return f"Nada con '{texto}'" + ("" if en_contenido else " en el nombre (prueba en_contenido=True)") + "."
    mas = " (puede haber más: acota con 'ruta' o con más palabras)" if len(hallados) >= limite else ""
    return f"{len(hallados)} resultado(s){mas}:\n" + "\n".join(hallados)


def _texto_de(real: Path) -> str:
    sufijo = real.suffix.lower()
    if sufijo == ".pdf":
        from pypdf import PdfReader
        paginas = [(p.extract_text() or "") for p in PdfReader(str(real)).pages]
        texto = "\n\n".join(paginas).strip()
        return texto or "(PDF sin texto: probablemente escaneado como imagen)"
    if sufijo == ".docx":
        from docx import Document
        doc = Document(str(real))
        partes = [p.text for p in doc.paragraphs]
        for tabla in doc.tables:
            for fila in tabla.rows:
                partes.append(" | ".join(c.text for c in fila.cells))
        return "\n".join(partes).strip()
    if sufijo in TEXTO or not sufijo:
        return real.read_text(encoding="utf-8", errors="replace")
    raise ErrorArchivos(f"No sé leer archivos {sufijo}; solo texto, Markdown, PDF y Word (.docx).")


def leer(ruta: str, desde: int = 0) -> str:
    nombre, raiz, real = resolver(ruta)
    if not real.is_file():
        raise ErrorArchivos(f"No existe el archivo {ruta}.")
    texto = _texto_de(real)
    trozo = texto[max(0, desde): max(0, desde) + MAX_LEER]
    sigue = desde + MAX_LEER < len(texto)
    pie = f"\n[continúa: llama de nuevo con desde={desde + MAX_LEER}; total {len(texto)} caracteres]" if sigue else ""
    return f"{_mostrar(nombre, raiz, real)}:\n{trozo}{pie}"


# ─── Cambios (nunca borran ni sobrescriben) ───────────────────────────────────

def crear(ruta: str, contenido: str, simular: bool = False) -> str:
    nombre, raiz, real = resolver(ruta)
    _puede_escribir(nombre, raiz, real)
    if real.suffix.lower() not in EDITABLES:
        raise ErrorArchivos(f"Solo se crean archivos {', '.join(sorted(EDITABLES))}.")
    if real.exists():
        raise ErrorArchivos(f"Ya existe {ruta}; no se sobrescribe. Usa anotar para agregarle texto.")
    if nombre == "vault" and real.suffix.lower() == ".md":
        contenido = _frontmatter(contenido)
    _revisar_texto(nombre, contenido)
    destino = _mostrar(nombre, raiz, real)
    if simular:
        return f"Crear {destino} ({len(contenido)} caracteres)."
    real.parent.mkdir(parents=True, exist_ok=True)
    with real.open("x", encoding="utf-8") as f:  # "x": falla si alguien lo creó entretanto
        f.write(contenido if contenido.endswith("\n") else contenido + "\n")
    _registrar("crear", ruta=destino, caracteres=len(contenido))
    return f"Creado {destino}."


def anotar(ruta: str, texto: str, simular: bool = False) -> str:
    nombre, raiz, real = resolver(ruta)
    _puede_escribir(nombre, raiz, real)
    if not real.is_file():
        raise ErrorArchivos(f"No existe {ruta}; para uno nuevo usa crear.")
    if real.suffix.lower() not in EDITABLES:
        raise ErrorArchivos(f"Solo se agrega texto a archivos {', '.join(sorted(EDITABLES))}.")
    if not texto.strip():
        raise ErrorArchivos("Falta el texto que se va a agregar.")
    _revisar_texto(nombre, texto)
    destino = _mostrar(nombre, raiz, real)
    if simular:
        return f"Agregar al final de {destino}: «{texto.strip()[:200]}»."
    actual = real.read_text(encoding="utf-8", errors="replace")
    separador = "" if actual.endswith("\n") or not actual else "\n"
    with real.open("a", encoding="utf-8") as f:
        f.write(f"{separador}{texto.strip()}\n")
    _registrar("anotar", ruta=destino, caracteres=len(texto))
    return f"Agregado a {destino}."


def mover(origen: str, destino: str, simular: bool = False) -> str:
    """Mover o renombrar. Si el destino es una carpeta que existe, el archivo entra en ella con su nombre."""
    n_o, r_o, p_o = resolver(origen)
    n_d, r_d, p_d = resolver(destino)
    _puede_escribir(n_o, r_o, p_o)
    if not p_o.exists():
        raise ErrorArchivos(f"No existe {origen}.")
    if p_d.is_dir():
        p_d = p_d / p_o.name
    _puede_escribir(n_d, r_d, p_d)
    if p_d.exists():
        raise ErrorArchivos(f"Ya existe {_mostrar(n_d, r_d, p_d)}; no se sobrescribe. Elige otro nombre.")
    if p_o.is_dir() and (p_d == p_o or p_o in p_d.parents):
        raise ErrorArchivos("No se puede mover una carpeta dentro de sí misma.")
    de, a = _mostrar(n_o, r_o, p_o), _mostrar(n_d, r_d, p_d)
    if simular:
        return f"Mover {de} a {a}."
    p_d.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(p_o), str(p_d))
    _registrar("mover", origen=de, destino=a)
    return f"Movido {de} a {a}."


def papelera(ruta: str, simular: bool = False) -> str:
    """'Borrar' = mover a <raíz>/Papelera con la fecha delante del nombre. Se recupera moviéndolo de vuelta."""
    nombre, raiz, real = resolver(ruta)
    _puede_escribir(nombre, raiz, real)
    if not real.exists():
        raise ErrorArchivos(f"No existe {ruta}.")
    if PAPELERA in real.relative_to(raiz).parts:
        raise ErrorArchivos("Ya está en la Papelera; vaciarla lo hace Gustavo a mano.")
    destino = raiz / PAPELERA / f"{_ahora():%Y%m%d-%H%M%S}-{real.name}"
    de, a = _mostrar(nombre, raiz, real), _mostrar(nombre, raiz, destino)
    if simular:
        return f"Mandar {de} a la Papelera ({a})."
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(real), str(destino))
    _registrar("papelera", origen=de, destino=a)
    return f"{de} quedó en la Papelera ({a})."
