#!/usr/bin/env bash
# Despliega el MCP de archivos (backend/servers/mcp_servers/files) en home-lab-laptop. Se corre desde un equipo con
# los alias ssh `home-lab-laptop` y `previseguros`, en la raíz del repo y con lo que haya en HEAD.
# La primera vez copia MCP_SECRET_KEY del .env del backend sin mostrarla y crea ~/archivos.
set -euo pipefail

DESTINO="tars-archivos"
cd "$(git rev-parse --show-toplevel)"

git archive HEAD backend/servers/mcp_servers/files \
  | ssh home-lab-laptop "mkdir -p ~/$DESTINO ~/archivos && tar -x -C ~/$DESTINO --strip-components=4"

if ! ssh home-lab-laptop "test -s ~/$DESTINO/.env"; then
  ssh previseguros "grep '^MCP_SECRET_KEY=' ~/portafolio/.env" \
    | ssh home-lab-laptop "umask 077 && cat > ~/$DESTINO/.env"
fi

# Arranca en ~8 s en esa laptop
ssh home-lab-laptop "cd ~/$DESTINO && mkdir -p registro && docker compose -p tars-archivos up -d --build \
  && for i in \$(seq 1 30); do curl -fsS http://127.0.0.1:8005/ping 2>/dev/null && echo && exit 0; sleep 1; done; \
  docker compose -p tars-archivos logs --tail 30; exit 1"
