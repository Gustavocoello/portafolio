"""MCP de archivos: corre en home-lab-laptop (no en el compose de previseguros-server) y el backend lo llama por
Tailscale. Toda la lógica y sus límites están en archivos.py; aquí solo el JWT y las herramientas."""
import os

import jwt
import uvicorn
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware, Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

import archivos

MCP_SECRET_KEY = os.getenv("MCP_SECRET_KEY")
if not MCP_SECRET_KEY:
    raise SystemExit("Falta MCP_SECRET_KEY (la misma del backend).")


class SoloBackend(BaseHTTPMiddleware):
    """Solo entra un JWT del backend firmado con MCP_SECRET_KEY y emitido para 'files' (dura 5 min)."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/ping":
            return await call_next(request)
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        try:
            datos = jwt.decode(token, MCP_SECRET_KEY, algorithms=["HS256"])
        except jwt.InvalidTokenError:
            return JSONResponse({"error": "No autorizado"}, status_code=401)
        if datos.get("provider") != "files":
            return JSONResponse({"error": "No autorizado"}, status_code=401)
        return await call_next(request)


mcp = FastMCP(name="Archivos de home-lab-laptop")


def _seguro(funcion, *args) -> str:
    try:
        return funcion(*args)
    except archivos.ErrorArchivos as e:
        return f"Error: {e}"
    except Exception as e:  # un PDF dañado, permisos...: el modelo debe decirlo, no inventar
        return f"Error inesperado ({type(e).__name__}): {e}"


@mcp.tool()
def archivos_listar(ruta: str = "") -> str:
    return _seguro(archivos.listar, ruta)


@mcp.tool()
def archivos_buscar(texto: str, ruta: str = "", en_contenido: bool = False) -> str:
    return _seguro(archivos.buscar, texto, ruta, en_contenido)


@mcp.tool()
def archivos_leer(ruta: str, desde: int = 0) -> str:
    return _seguro(archivos.leer, ruta, desde)


@mcp.tool()
def archivos_crear(ruta: str, contenido: str, simular: bool = False) -> str:
    return _seguro(archivos.crear, ruta, contenido, simular)


@mcp.tool()
def archivos_anotar(ruta: str, texto: str, simular: bool = False) -> str:
    return _seguro(archivos.anotar, ruta, texto, simular)


@mcp.tool()
def archivos_mover(origen: str, destino: str, simular: bool = False) -> str:
    return _seguro(archivos.mover, origen, destino, simular)


@mcp.tool()
def archivos_papelera(ruta: str, simular: bool = False) -> str:
    return _seguro(archivos.papelera, ruta, simular)


mcp_app = mcp.http_app(path="/mcp")
protegida = Starlette(routes=[Mount("/", app=mcp_app)])
protegida.add_middleware(SoloBackend)

app = Starlette(
    routes=[
        Route("/ping", lambda r: JSONResponse({"status": "ok", "service": "files-mcp"})),
        Mount("/mcp-server", app=protegida),
    ],
    lifespan=mcp_app.lifespan,
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8005")))
