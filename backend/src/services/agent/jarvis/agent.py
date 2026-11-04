import os
import sys
import pytz
from pathlib import Path
from datetime import datetime, timedelta

current_dir = Path(__file__).resolve().parent.parent.parent
backend_dir = current_dir.parent.parent
sys.path.insert(0, str(backend_dir))

from src.core.time_helper import get_now
from src.services.agent.common.base_agent import BaseAgent
from src.services.llm.chat.llm_router import get_langchain_llm

from src.services.agent.jarvis.tool import build_jarvis_tools
from src.services.agent.jarvis.tools.archivos import archivos_disponibles, build_archivos_tools, es_del_vault, necesita_archivos
from src.services.agent.jarvis.tools.panel import build_panel_tools, necesita_panel, panel_disponible

def get_jarvis_template():
    """Genera el template maestro leyendo AGENT.md y agregando sufijos de LangChain."""
    # La hora NO se escribe aquí: el agente vive 12 h en caché y TARS daba la hora de cuando se creó.
    # BaseAgent cambia CURRENT_DATE_PLACEHOLDER por la hora real en cada mensaje.
    current_date = "CURRENT_DATE_PLACEHOLDER"

    # 1. Leer dinámicamente el archivo AGENT.md
    agent_md_path = Path(__file__).resolve().parent / "AGENT.md"
    with open(agent_md_path, "r", encoding="utf-8") as f:
        agent_identity_and_rules = f.read()

    # 2. Agregar las variables obligatorias que LangChain necesita para funcionar
    langchain_suffix = f"""
CURRENT DATE AND TIME (Ecuador GMT-5): {current_date}
Use this date as reference for "today", "tomorrow", "this week", etc.
NEVER use years prior to 2026.

LANGUAGE RULE: Always respond in the exact same language the user used.
"""

    # 3. Unir todo y reemplazar la fecha
    return agent_identity_and_rules + "\n" + langchain_suffix


class JarvisAgent(BaseAgent):
    name = "Jarvis"

    def __init__(self, user_id: str, client_type: str = "web"):
        self.user_id = user_id
        llm = get_langchain_llm() 
        tools = build_jarvis_tools(user_id=user_id, client_type=client_type)
        template = get_jarvis_template()
        if client_type == "tars":  # mismas herramientas, voz y personalidad de TARS
            template += "\n" + (Path(__file__).resolve().parent / "TARS.md").read_text(encoding="utf-8")
        super().__init__(llm, tools, template)
        # Archivos y vault (home-lab-laptop y laptop Windows) y panel BrokerIA: herramientas extra que solo se cargan
        # cuando el mensaje las necesita (cada herramienta agranda todos los pedidos al modelo). Un grafo por
        # combinación, creado la primera vez que hace falta; todos comparten la memoria del hilo.
        self.archivos = build_archivos_tools(user_id) if archivos_disponibles() else []
        self.panel = build_panel_tools(user_id) if panel_disponible() else []
        self._grafos: dict[tuple[bool, bool, bool], object] = {}

    def _app_para(self, instruction: str, user_id: str):
        # "vault" o "inbox" sin decir Notion: sin las herramientas de Notion, que el modelo a veces elegía igual
        vault = bool(self.archivos) and es_del_vault(instruction)
        archivos = vault or (bool(self.archivos) and necesita_archivos(instruction, user_id))
        panel = bool(self.panel) and necesita_panel(instruction, user_id)
        clave = (archivos, vault, panel)
        if not any(clave):
            return self.app
        if clave not in self._grafos:
            base = [t for t in self.tools if not (vault and t.name.startswith("notion_"))]
            self._grafos[clave] = self._grafo(base + (self.archivos if archivos else []) + (self.panel if panel else []))
        return self._grafos[clave]


# ─── Factory con caché + TTL de 12 horas ────────────────────────────────────
_jarvis_cache: dict[str, tuple] = {}
_CACHE_TTL = timedelta(hours=12)

def get_jarvis(user_id: str, client_type: str = "web") -> JarvisAgent:
    """
    Retorna la instancia de JarvisAgent para ese user_id.
    La crea si no existe, la reutiliza si ya está en caché.
    """
    now = get_now()
    cache_key = f"{user_id}:{client_type}"  # distingue sesión CLI vs web del mismo user
    if cache_key in _jarvis_cache:
        agent, created_at = _jarvis_cache[cache_key]
        if now - created_at < _CACHE_TTL:
            return agent
    
    agent = JarvisAgent(user_id=user_id, client_type=client_type)
    _jarvis_cache[cache_key] = (agent, now)
    return agent

if __name__ == "__main__":
    import os
    import uuid
    test_user = os.getenv("USUARIO_TEST")
    # 1. Creamos un ID único para ESTA conversación en la terminal
    memory_thread = str(uuid.uuid4())

    print("\n" + "=" * 50)
    print("JARVIS: PERSONAL ASSISTANT")
    print("Type 'q' to exit.")
    print("=" * 50)

    jarvis = get_jarvis(user_id=test_user)

    while True:
        try:
            user_input = input("\nUser: ")
            if user_input.lower() in ["salir", "exit", "quit", "q"]:
                print("Jarvis going offline.")
                break
            if user_input.lower() in ["reload", "restart", "reboot"]:
                _jarvis_cache.clear()
                jarvis = get_jarvis(user_id=test_user)
                print("Jarvis reloaded with updated AGENT.md")
                continue
            if not user_input.strip():
                continue
            print("\nJarvis thinking...")
            result = jarvis.run_task(
                instruction=user_input, 
                user_id=test_user,
                chat_id=None,
                thread_id=memory_thread,
            )
            print(f"\nJarvis: {result['output']}")
        except KeyboardInterrupt:
            print("\nInterrupt detected. Exiting...")
            break
        except Exception as e:
            print(f"\nError: {e}")