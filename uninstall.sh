#!/usr/bin/env bash
# Reverses install.sh: removes the symlinks, the saved addresses and API keys
# and the header cache. Never touches Sonarr, Radarr or Lidarr themselves.

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_ID="io.github.sette7blo.omaservarr"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
PLUGIN_LINK="$CONFIG_HOME/omarchy/plugins/$PLUGIN_ID"
CLI_LINK="$HOME/.local/bin/omaservarr"
DESKTOP_LINK="$DATA_HOME/applications/omaservarr.desktop"
# Linked by versions before the menu file was dropped.
MENU_LINK="$CONFIG_HOME/omarchy/extensions/omarchy-menu-omaservarr.jsonc"
STATE_DIR="$STATE_HOME/omarchy/omaservarr"
CACHE_DIR="$CACHE_HOME/omarchy/omaservarr"

log() { printf '[omaservarr] %s\n' "$*"; }

remove_link() {
  local path="$1"
  if [[ -L "$path" ]]; then
    unlink "$path"
    log "removed $path"
  fi
}

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin disable "$PLUGIN_ID" >/dev/null 2>&1 || true
fi

# A plugin added with omarchy plugin add is a folder, not a link; omarchy
# plugin remove takes that away.
remove_link "$PLUGIN_LINK"
remove_link "$CLI_LINK"
remove_link "$DESKTOP_LINK"
remove_link "$MENU_LINK"

for agent_home in "$HOME/.claude" "$HOME/.codex" "$HOME/.agents" "$HOME/.copilot"; do
  [[ -d "$agent_home/skills" ]] || continue
  for skill_src in "$PROJECT_DIR"/agent-skill/*/; do
    [[ -d "$skill_src" ]] || continue
    remove_link "$agent_home/skills/$(basename "$skill_src")"
  done
done

for dir in "$STATE_DIR" "$CACHE_DIR"; do
  if [[ -d "$dir" ]]; then
    rm -rf "$dir"
    log "removed $dir"
  fi
done

if command -v omarchy-shell >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi

log "uninstalled $PLUGIN_ID"
