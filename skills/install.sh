#!/usr/bin/env bash
# install.sh — register the Hermes Mobile Gateway skills with this Hermes agent.
#
# Run ONCE on the host where Hermes runs (the Pi):
#   cd ~/hermes-mobile-gateway && bash skills/install.sh
#
# After this, the agent can drive setup itself — just tell it
# "set up the mobile gateway" and it will follow the mobile-gateway-setup skill.
#
# Hermes only indexes skills named exactly SKILL.md inside a per-skill
# directory under a skills dir, so we install them as <name>/SKILL.md.
set -euo pipefail

SKILLS_DIR="${HERMES_SKILLS_DIR:-$HOME/.hermes/skills}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/.." && pwd)"

install_skill() {
  local name="$1" src="$2"
  mkdir -p "$SKILLS_DIR/$name"
  cp "$src" "$SKILLS_DIR/$name/SKILL.md"
  echo "  installed $name  ->  $SKILLS_DIR/$name/SKILL.md"
}

echo "Installing Hermes Mobile Gateway skills into $SKILLS_DIR"
install_skill "mobile-gateway-setup" "$HERE/mobile-gateway-setup/SKILL.md"
install_skill "mobile-gateway-usage" "$HERE/mobile-gateway-usage/SKILL.md"

# The UI skill (tells the agent how to emit interactive blocks). Lives with the
# plugin; install it here too so it appears in the prompt index (a plugin's own
# register_skill() is intentionally kept out of that index).
if [[ -f "$PROJECT/plugin/app-ui/HERMES_UI.skill.md" ]]; then
  install_skill "hermes-mobile-ui" "$PROJECT/plugin/app-ui/HERMES_UI.skill.md"
fi

echo "Done. Restart Hermes (or run 'hermes skills' / 'hermes gateway status') to confirm."
