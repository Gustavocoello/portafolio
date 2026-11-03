# Instala o actualiza el MCP de archivos (backend/servers/mcp_servers/files) en esta laptop Windows para TARS.
# Correr desde la raíz del repo, sin admin:  powershell -ExecutionPolicy Bypass -File scripts\archivos-windows.ps1
# - Copia el servidor a %LOCALAPPDATA%\tars-archivos con su propio venv y lo arranca oculto (pythonw).
# - La primera vez copia MCP_SECRET_KEY del .env del backend (ssh previseguros) sin mostrarla.
# - Arranca solo al iniciar sesión (acceso directo en Inicio) y pide admin una vez para abrir el puerto 8005,
#   solo para Tailscale (100.64.0.0/10). Todo pedido sin el JWT del backend recibe 401.
# Carpetas que ve TARS: documentos, descargas, escritorio, datos (C:\work\Data) y work (C:\work, solo lectura).
# -SinFirewall: sin pedir admin (p. ej. por ssh o sin nadie frente a la laptop); la regla se agrega después.
param([switch]$SinFirewall)
$ErrorActionPreference = "Stop"

$raiz = (git rev-parse --show-toplevel).Trim()
$origen = Join-Path $raiz "backend\servers\mcp_servers\files"
$destino = Join-Path $env:LOCALAPPDATA "tars-archivos"
$puerto = 8005
New-Item -ItemType Directory -Force (Join-Path $destino "registro") | Out-Null

# 1. Detener el que corre (si hay) y copiar el código
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
  Where-Object { $_.CommandLine -like "*tars-archivos*files_server.py*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
foreach ($f in "archivos.py", "files_server.py", "requirements.txt") { Copy-Item (Join-Path $origen $f) $destino -Force }

# 2. venv propio
$venv = Join-Path $destino "venv"
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) { python -m venv $venv }
& (Join-Path $venv "Scripts\python.exe") -m pip install -q --disable-pip-version-check -r (Join-Path $destino "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install falló" }

# 3. .env: el secreto se conserva; la configuración se reescribe en cada corrida
$envFile = Join-Path $destino ".env"
$secreto = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -like "MCP_SECRET_KEY=*" } } else { $null }
if (-not $secreto) {
  $secreto = (ssh previseguros "grep '^MCP_SECRET_KEY=' ~/portafolio/.env" | Select-Object -First 1)
  if (-not $secreto) { throw "No pude leer MCP_SECRET_KEY de previseguros (ssh previseguros)." }
}
$carpetas = @(
  "documentos=$([Environment]::GetFolderPath('MyDocuments'))",
  "descargas=$env:USERPROFILE\Downloads",
  "escritorio=$([Environment]::GetFolderPath('Desktop'))",
  "datos=C:\work\Data",
  "work=C:\work"
) -join ","
$lineas = @(
  $secreto,
  "ARCHIVOS_EQUIPO=Archivos de la laptop Windows",
  "ARCHIVOS_RAICES=$carpetas",
  "ARCHIVOS_SOLO_LECTURA=work",
  "ARCHIVOS_REGISTRO=$destino\registro\cambios.jsonl",
  "PORT=$puerto"
)
[IO.File]::WriteAllLines($envFile, $lineas, (New-Object Text.UTF8Encoding $false))  # sin BOM
icacls $envFile /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null  # solo este usuario lo lee

# 4. Arranque al iniciar sesión y ahora
$pythonw = Join-Path $venv "Scripts\pythonw.exe"
$servidor = Join-Path $destino "files_server.py"
$atajo = Join-Path ([Environment]::GetFolderPath("Startup")) "TARS archivos.lnk"
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($atajo)
$lnk.TargetPath = $pythonw
$lnk.Arguments = "`"$servidor`""
$lnk.WorkingDirectory = $destino
$lnk.Save()
Start-Process -FilePath $pythonw -ArgumentList "`"$servidor`"" -WorkingDirectory $destino -WindowStyle Hidden

# 5. Firewall: el puerto solo para Tailscale (pide admin una vez)
if ($SinFirewall) {
  Write-Host "Sin regla de firewall: vuelve a correr el script sin -SinFirewall frente a la laptop."
} elseif (-not (Get-NetFirewallRule -DisplayName "TARS archivos (Tailscale)" -ErrorAction SilentlyContinue)) {
  $regla = "New-NetFirewallRule -DisplayName 'TARS archivos (Tailscale)' -Direction Inbound -Protocol TCP " +
           "-LocalPort $puerto -RemoteAddress 100.64.0.0/10 -Action Allow -Profile Any | Out-Null"
  Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile", "-Command", $regla
}

# 6. Comprobar
$ip = (tailscale ip -4 | Select-Object -First 1).Trim()
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-RestMethod "http://${ip}:$puerto/ping" -TimeoutSec 2
    Write-Host "Listo: TARS llega a esta laptop en http://${ip}:$puerto/mcp-server/mcp ($($r.status))"
    exit 0
  } catch { Start-Sleep -Seconds 1 }
}
Write-Host "No responde en ${ip}:$puerto. Log: $destino\servidor.log"
if (Test-Path "$destino\servidor.log") { Get-Content "$destino\servidor.log" -Tail 30 }
exit 1
