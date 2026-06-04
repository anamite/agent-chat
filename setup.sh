#!/usr/bin/env bash
# setup.sh — one command to get the Hermes Mobile Gateway running.
# Run from the project directory:
#   cd ~/hermes-mobile-gateway && bash setup.sh
#
# What it does:
#   1. Finds your Hermes API key automatically
#   2. Writes the bridge env file permanently
#   3. Installs + starts the bridge as a systemd service
#   4. Prints the pairing QR
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJ"

echo ""
echo "━━━  Hermes Mobile Gateway Setup  ━━━"
echo ""

# ── 1. Find the Hermes API key ─────────────────────────────────────────────
echo "▸ Finding Hermes API key..."

API_KEY=""

# Try environment first
API_KEY="${API_SERVER_KEY:-}"

# Try common config files
if [[ -z "$API_KEY" ]]; then
    for f in ~/.hermes/.env ~/.hermes/hermes.env ~/.hermes/config.env \
              ~/hermes-agent/.env /etc/hermes/hermes.env; do
        if [[ -f "$f" ]]; then
            KEY=$(grep -m1 "API_SERVER_KEY" "$f" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
            if [[ -n "$KEY" ]]; then API_KEY="$KEY"; echo "  found in $f"; break; fi
        fi
    done
fi

# Try running process environment
if [[ -z "$API_KEY" ]]; then
    PID=$(pgrep -f "hermes" | head -1 || true)
    if [[ -n "$PID" ]]; then
        KEY=$(cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep "^API_SERVER_KEY=" | cut -d= -f2- || true)
        if [[ -n "$KEY" ]]; then API_KEY="$KEY"; echo "  found in process env (PID $PID)"; fi
    fi
fi

# Try systemd service
if [[ -z "$API_KEY" ]]; then
    for svc in hermes hermes-agent; do
        KEY=$(systemctl show "$svc" 2>/dev/null | grep "Environment=" | grep -o "API_SERVER_KEY=[^ ]*" | cut -d= -f2- || true)
        if [[ -z "$KEY" ]]; then
            KEY=$(systemctl --user show "$svc" 2>/dev/null | grep "Environment=" | grep -o "API_SERVER_KEY=[^ ]*" | cut -d= -f2- || true)
        fi
        if [[ -n "$KEY" ]]; then API_KEY="$KEY"; echo "  found in systemd service $svc"; break; fi
    done
fi

if [[ -z "$API_KEY" ]]; then
    echo ""
    echo "  ⚠  Could not find API_SERVER_KEY automatically."
    echo "  Run this to find it:  grep -r API_SERVER_KEY ~/.hermes/"
    echo ""
    read -rp "  Paste your API_SERVER_KEY here: " API_KEY
fi

echo "  API key: ${API_KEY:0:8}…(found)"
echo ""

# ── 2. Find Pi's LAN IP ────────────────────────────────────────────────────
echo "▸ Finding LAN IP..."
LAN_IP=$(hostname -I | awk '{print $1}')
echo "  IP: $LAN_IP"
echo ""

# ── 3. Generate internal token ─────────────────────────────────────────────
echo "▸ Generating internal token..."

# Reuse existing token if already set (so plugin stays in sync)
EXISTING_TOKEN=""
if [[ -f "$PROJ/bridge/systemd/hermes-bridge.env" ]]; then
    EXISTING_TOKEN=$(grep "^BRIDGE_INTERNAL_TOKEN=" "$PROJ/bridge/systemd/hermes-bridge.env" 2>/dev/null | cut -d= -f2-)
fi
INTERNAL_TOKEN="${EXISTING_TOKEN:-$(python3 -c "import secrets; print(secrets.token_hex(32))")}"
echo "  Token: ${INTERNAL_TOKEN:0:8}…"
echo ""

# ── 4. Write the env file ──────────────────────────────────────────────────
echo "▸ Writing bridge/systemd/hermes-bridge.env..."
cat > "$PROJ/bridge/systemd/hermes-bridge.env" <<EOF
BRIDGE_INTERNAL_TOKEN=${INTERNAL_TOKEN}
BRIDGE_PUBLIC_URL=ws://${LAN_IP}:8787
BRIDGE_HERMES_URL=http://127.0.0.1:8642
BRIDGE_HERMES_KEY=${API_KEY}
EOF
chmod 600 "$PROJ/bridge/systemd/hermes-bridge.env"
echo "  Written."
echo ""

# ── 5. Install & start the systemd service ─────────────────────────────────
echo "▸ Installing systemd service..."

# Patch the service file to use this project path and venv
sed "s|/home/hermes/hermes-mobile-gateway|$PROJ|g" \
    "$PROJ/bridge/systemd/hermes-bridge.service" \
    > /tmp/hermes-bridge.service

# Install as root or user service
if sudo cp /tmp/hermes-bridge.service /etc/systemd/system/hermes-bridge.service 2>/dev/null; then
    sudo systemctl daemon-reload
    sudo systemctl enable hermes-bridge
    sudo systemctl restart hermes-bridge
    sleep 2
    STATUS=$(sudo systemctl is-active hermes-bridge 2>/dev/null || echo "unknown")
else
    echo "  (no sudo — trying user service)"
    mkdir -p ~/.config/systemd/user
    cp /tmp/hermes-bridge.service ~/.config/systemd/user/hermes-bridge.service
    systemctl --user daemon-reload
    systemctl --user enable hermes-bridge
    systemctl --user restart hermes-bridge
    sleep 2
    STATUS=$(systemctl --user is-active hermes-bridge 2>/dev/null || echo "unknown")
fi

echo "  Service status: $STATUS"
echo ""

# Fallback: if service failed, run directly in background
if [[ "$STATUS" != "active" ]]; then
    echo "  ⚠  Service didn't start — running directly..."
    pkill -f "uvicorn bridge" 2>/dev/null || true
    sleep 1
    set -a; source "$PROJ/bridge/systemd/hermes-bridge.env"; set +a
    nohup "$PROJ/.venv/bin/python" -m uvicorn bridge.main:app \
        --host 0.0.0.0 --port 8787 \
        > "$PROJ/bridge/bridge.log" 2>&1 &
    sleep 2
    echo "  Running directly (PID $!). Log: $PROJ/bridge/bridge.log"
fi

# ── 6. Verify bridge is up ─────────────────────────────────────────────────
echo "▸ Checking bridge health..."
HEALTH=$(curl -sf http://127.0.0.1:8787/health 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q '"ok":true'; then
    echo "  ✓ Bridge is healthy"
else
    echo "  ✗ Bridge health check failed — check $PROJ/bridge/bridge.log"
    exit 1
fi
echo ""

# ── 7. Install skills ──────────────────────────────────────────────────────
echo "▸ Installing skills..."
bash "$PROJ/skills/install.sh" 2>/dev/null && echo "  ✓ Skills installed" || echo "  (skipped)"
echo ""

# ── 8. Print pairing QR ───────────────────────────────────────────────────
echo "▸ Generating pairing QR..."
echo ""
set -a; source "$PROJ/bridge/systemd/hermes-bridge.env"; set +a
"$PROJ/.venv/bin/python" -m bridge.cli pair --label "my-phone"

echo ""
echo "━━━  Done  ━━━"
echo ""
echo "In the app → Settings → Pair → scan the QR above."
echo "Status pill should turn green within a few seconds."
echo ""
echo "To check bridge logs:  journalctl -u hermes-bridge -f"
echo "To re-generate QR:     cd $PROJ && source .venv/bin/activate && bridge pair"
echo ""
