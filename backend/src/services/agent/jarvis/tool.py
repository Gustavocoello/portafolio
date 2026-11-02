# src/services/agent/jarvis/tool.py
from src.services.agent.jarvis.tools.calendar import build_calendar_tools
from src.services.agent.jarvis.tools.email import build_email_tools
from src.services.agent.jarvis.tools.github import build_github_tools
from src.services.agent.jarvis.tools.notion import build_notion_tools
from src.services.agent.jarvis.tools.research import build_research_tools


def build_jarvis_tools(user_id: str, client_type: str = "web") -> list:
    return [
        *build_email_tools(),
        *build_calendar_tools(user_id),
        *build_notion_tools(user_id),
        *build_github_tools(user_id),
        *build_research_tools(user_id, client_type=client_type),
    ]
