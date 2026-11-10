#!/usr/bin/env bash
# ============================================================
#  G0DM0D3 ⇄ OpenCode Bridge — installateur une commande
#  Utilisation :
#     bash install.sh            # installation standard
#     AUTO_START=0 bash install.sh   # sans lancement auto au login
# ============================================================
set -e

BRIDGE_DIR="${BRIDGE_DIR:-$HOME/.godmod3-bridge}"
BRIDGE_PORT="${BRIDGE_PORT:-5791}"
SOURCE_URL="${SOURCE_URL:-}"   # URL raw de bridge.mjs si publié sur GitHub

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   G0DM0D3 ⇄ OpenCode Bridge — Installer  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# --- 1. Node ≥ 18 ---
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js manquant. Installez-le puis relancez :"
  echo "   https://nodejs.org  (ou: brew install node)"
  exit 1
fi
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node >= 18 requis (trouvé: $(node -v))"; exit 1
fi
echo "✅ Node $(node -v)"

# --- 2. opencode CLI ---
if ! command -v opencode >/dev/null 2>&1; then
  echo "❌ CLI opencode manquant — c'est LUI qui authentifie vos modèles gratuits."
  echo ""
  echo "   Installez-le, connectez-vous, puis relancez cet installateur :"
  echo "     curl -fsSL https://opencode.ai/install | bash"
  echo "     opencode            # connexion / premier lancement (compte gratuit)"
  exit 1
fi
echo "✅ opencode $(opencode --version 2>/dev/null || echo '?')"

# --- 3. Fichiers ---
mkdir -p "$BRIDGE_DIR"
TARGET="$BRIDGE_DIR/bridge.mjs"
if [ -n "$SOURCE_URL" ]; then
  echo "⬇️  Téléchargement de bridge.mjs…"
  curl -fsSL "$SOURCE_URL" -o "$TARGET"
elif [ -f "$(dirname "$0")/bridge.mjs" ]; then
  cp "$(dirname "$0")/bridge.mjs" "$TARGET"
  echo "✅ bridge.mjs copié depuis le dossier local"
else
  echo "⚠️  SOURCE_URL vide et bridge.mjs introuvable à côté d'install.sh."
  echo "   Placez bridge.mjs dans le même dossier que install.sh,"
  echo "   ou publiez le pont dans un repo GitHub et relancez :"
  echo "   SOURCE_URL=https://raw.githubusercontent/<user>/<repo>/main/bridge.mjs bash install.sh"
  exit 1
fi

# --- 4. Démarrage automatique (launchd macOS | systemd Linux) ---
start_auto() {
  if [ "$(uname)" = "Darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/ai.godmod3.bridge.plist"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.godmod3.bridge</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>exec node "$TARGET"</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>BRIDGE_PORT</key><string>$BRIDGE_PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BRIDGE_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$BRIDGE_DIR/server.log</string>
</dict></plist>
PL
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "✅ Lancement auto au login (launchd)"
  elif command -v systemctl >/dev/null 2>&1; then
    SVC_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SVC_DIR"
    cat > "$SVC_DIR/godmod3-bridge.service" <<SV
[Unit]
Description=G0DM0D3 OpenCode Bridge
[Service]
ExecStart=%h/.local/bin/node-or-system-node "$TARGET"
Environment=BRIDGE_PORT=$BRIDGE_PORT
Restart=always
[Install]
WantedBy=default.target
SV
    if ! node -e "0" 2>/dev/null; then echo "    (adaptez ExecStart au chemin de node: $(command -v node))"; fi
    systemctl --user daemon-reload
    systemctl --user enable --now godmod3-bridge.service
    echo "✅ Service systemd activé (systemctl --user status godmod3-bridge)"
  else
    echo "⚠️  Pas d'autostart automatique — lancez manuellement: node $TARGET"
  fi
}

if [ "${AUTO_START:-1}" = "1" ]; then start_auto; fi

# --- 5. Vérification ---
sleep 2
if curl -sf "http://localhost:$BRIDGE_PORT/health" >/dev/null 2>&1; then
  COUNT=$(curl -sf "http://localhost:$BRIDGE_PORT/v1/models" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).data.length)}catch{console.log("?")}})')
  echo ""
  echo "=========================================="
  echo "  ✅ Bridge actif sur http://localhost:$BRIDGE_PORT"
  echo "  📦 $COUNT modèle(s) gratuit(s) opencode"
  echo ""
  echo "  Dans godmod3 (Settings → Local Models) :"
  echo "  ➜  http://localhost:$BRIDGE_PORT/v1"
  echo "=========================================="
else
  echo "⏳ Le pont démarre… vérifiez le log: $BRIDGE_DIR  (server.log)"
fi
