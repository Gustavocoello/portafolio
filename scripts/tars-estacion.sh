#!/usr/bin/env bash
# Estación de TARS: abre /project-tars a pantalla completa en un equipo fijo con micrófono y parlante (como un Alexa).
# Uso: ./tars-estacion.sh            abre la estación
#      ./tars-estacion.sh instalar   además la abre sola al iniciar sesión en el equipo
# La primera vez inicia sesión con tu cuenta en la ventana que se abre; el perfil propio guarda la sesión.
set -euo pipefail

URL="${TARS_URL:-https://portafolio.brokeria.ec/project-tars}"
PERFIL="${TARS_PERFIL:-$HOME/.config/tars-estacion}"
NAVEGADOR="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
[ -n "$NAVEGADOR" ] || { echo "Instala Google Chrome o Chromium" >&2; exit 1; }

if [ "${1:-}" = "instalar" ]; then
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/tars-estacion.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=TARS
Exec=$(realpath "$0")
X-GNOME-Autostart-enabled=true
DESKTOP
  echo "Listo: TARS se abrirá al iniciar sesión."
fi

# --autoplay-policy: TARS puede hablar sin que nadie toque la pantalla
# --use-fake-ui-for-media-stream: acepta el micrófono sin preguntar (solo en este perfil)
exec "$NAVEGADOR" \
  --user-data-dir="$PERFIL" \
  --kiosk "$URL" \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --noerrdialogs --disable-session-crashed-bubble --disable-infobars --no-first-run
