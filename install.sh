#!/usr/bin/env bash
# Idempotent installer for the omaservarr Omarchy plugin.
# Links the CLI and the launcher and enables the bar widget. The plugin runs
# it with --if-needed on every load, so after `omarchy plugin add` there is
# nothing else to run. The agent skills are linked only on request, with
# --skills; a run without it never creates or checks them.

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_ID="io.github.sette7blo.omaservarr"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
PLUGIN_LINK="$CONFIG_HOME/omarchy/plugins/$PLUGIN_ID"
CLI_LINK="$HOME/.local/bin/omaservarr"
DESKTOP_LINK="$DATA_HOME/applications/omaservarr.desktop"
# Older versions linked a menu file here; Omarchy only reads one menu file.
OLD_MENU_LINK="$CONFIG_HOME/omarchy/extensions/omarchy-menu-omaservarr.jsonc"
AGENT_HOMES=("$HOME/.claude" "$HOME/.codex" "$HOME/.agents" "$HOME/.copilot")
CONNECTION_DIR="$STATE_HOME/omarchy/omaservarr"
CONNECTION_FILE="$CONNECTION_DIR/credentials.json"

declare -A URLS=([sonarr]="" [radarr]="" [lidarr]="")
ENABLE=true
IF_NEEDED=false
SKILLS=false
SKILLS_STATUS=false

usage() {
  cat <<USAGE
Usage: $0 [--sonarr-url URL] [--radarr-url URL] [--lidarr-url URL] [--skills] [--no-enable] [--if-needed]
       $0 --skills-status

The --*-url options pre-fill the addresses the plugin and the omaservarr CLI
share. API keys are entered in the plugin's Settings view.
--skills    also links the agent skills into the agent homes that exist
            (~/.agents, ~/.claude, ~/.codex, ~/.copilot). Never done without
            this option. uninstall.sh --skills removes them again.
            The Settings view has a button that does the same.
--skills-status prints installed, none, or unavailable (no agent home found)
            and changes nothing.
--no-enable links everything but leaves the bar widget for you to enable.
--if-needed does nothing when everything is already in place. The plugin's
            service runs the installer this way each time it loads.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sonarr-url|--radarr-url|--lidarr-url)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      name="${1#--}"; name="${name%-url}"
      [[ "$2" =~ ^https?://[^[:space:]\"\\]+$ ]] || { echo "$1 must be an http:// or https:// address" >&2; exit 2; }
      URLS[$name]="${2%/}"; shift 2 ;;
    --skills)
      SKILLS=true; shift ;;
    --skills-status)
      SKILLS_STATUS=true; shift ;;
    --no-enable)
      ENABLE=false; shift ;;
    --if-needed)
      IF_NEEDED=true; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      usage >&2; exit 2 ;;
  esac
done

log() { printf '[omaservarr] %s\n' "$*"; }

link_path() {
  local source_path="$1"
  local target_path="$2"
  mkdir -p "$(dirname "$target_path")"
  if [[ -L "$target_path" && "$(readlink -f "$target_path")" == "$(readlink -f "$source_path")" ]]; then
    return
  fi
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    mv "$target_path" "$target_path.bak.$TIMESTAMP"
    log "backed up existing $target_path"
  fi
  ln -s "$source_path" "$target_path"
}

# Addresses live with the API keys in the connection file, which the plugin's
# Settings view also writes. Only touch it when a --*-url option is given.
write_connection() {
  local name any=false
  for name in sonarr radarr lidarr; do
    [[ -n "${URLS[$name]}" ]] && any=true
  done
  $any || return 0
  if ! command -v jq >/dev/null 2>&1; then
    log "jq not found; set the addresses in the plugin's Settings view"
    return 0
  fi
  mkdir -p "$CONNECTION_DIR"
  chmod 700 "$CONNECTION_DIR"
  local tmp
  tmp="$(mktemp -p "$CONNECTION_DIR" .tmp.XXXXXX)"
  if [[ -s "$CONNECTION_FILE" ]]; then cat "$CONNECTION_FILE"; else echo '{}'; fi \
    | jq --arg sonarr "${URLS[sonarr]}" --arg radarr "${URLS[radarr]}" --arg lidarr "${URLS[lidarr]}" '
        reduce (["sonarr", $sonarr], ["radarr", $radarr], ["lidarr", $lidarr]) as [$name, $url] (.;
          .[$name] = ({baseUrl: "", apiKey: ""} + (.[$name] // {}))
          | if $url != "" then .[$name].baseUrl = $url else . end)' > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$CONNECTION_FILE"
  log "set addresses in $CONNECTION_FILE"
}

linked_to() {
  [[ -L "$1" && "$(readlink -f "$1")" == "$(readlink -f "$2")" ]]
}

setup_complete() {
  local skill_src agent_home
  linked_to "$CLI_LINK" "$PROJECT_DIR/bin/omaservarr" || return 1
  [[ -e "$PROJECT_DIR/omaservarr.desktop" ]] && linked_to "$DESKTOP_LINK" "$PROJECT_DIR/omaservarr.desktop" || return 1
  [[ -L "$OLD_MENU_LINK" ]] && return 1
  $SKILLS || return 0
  for skill_src in "$PROJECT_DIR"/agent-skill/*/; do
    [[ -d "$skill_src" ]] || continue
    for agent_home in "${AGENT_HOMES[@]}"; do
      [[ -d "$agent_home" ]] || continue
      linked_to "$agent_home/skills/$(basename "$skill_src")" "$skill_src" || return 1
    done
  done
  return 0
}

skills_status() {
  local skill_src agent_home homes=0 linked=0
  for agent_home in "${AGENT_HOMES[@]}"; do
    [[ -d "$agent_home" ]] || continue
    homes=$((homes + 1))
    for skill_src in "$PROJECT_DIR"/agent-skill/*/; do
      [[ -d "$skill_src" ]] || continue
      if linked_to "$agent_home/skills/$(basename "$skill_src")" "$skill_src"; then
        linked=$((linked + 1))
      fi
    done
  done
  if (( homes == 0 )); then echo unavailable
  elif (( linked == 0 )); then echo none
  else echo installed
  fi
}

install_plugin_link() {
  # omarchy plugin add already cloned this folder into the plugin directory.
  # Linking it onto itself would move the checkout aside.
  if [[ -e "$PLUGIN_LINK" || -L "$PLUGIN_LINK" ]] \
    && [[ "$(readlink -f "$PLUGIN_LINK")" == "$PROJECT_DIR" ]]; then
    return
  fi
  link_path "$PROJECT_DIR" "$PLUGIN_LINK"
  log "linked plugin dir -> $PLUGIN_LINK"
}

install_cli() {
  chmod +x "$PROJECT_DIR/bin/omaservarr"
  link_path "$PROJECT_DIR/bin/omaservarr" "$CLI_LINK"
  log "linked CLI -> $CLI_LINK"
}

install_desktop() {
  # The launcher goes through the CLI so it follows the configured addresses.
  local rendered="$PROJECT_DIR/omaservarr.desktop"
  sed "s|@@OMASERVARR_CLI@@|$CLI_LINK|g" "$PROJECT_DIR/omaservarr.desktop.in" > "$rendered"
  link_path "$rendered" "$DESKTOP_LINK"
  log "linked .desktop -> $DESKTOP_LINK"
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true
}

remove_old_menu() {
  if [[ -L "$OLD_MENU_LINK" ]]; then
    unlink "$OLD_MENU_LINK"
    log "removed the old menu link $OLD_MENU_LINK"
  fi
}

install_skills() {
  local skill_src skill_name agent_home
  for skill_src in "$PROJECT_DIR"/agent-skill/*/; do
    [[ -d "$skill_src" ]] || continue
    skill_name="$(basename "$skill_src")"
    for agent_home in "${AGENT_HOMES[@]}"; do
      if [[ -d "$agent_home" ]]; then
        link_path "${skill_src%/}" "$agent_home/skills/$skill_name"
        log "linked skill $skill_name -> $agent_home/skills/"
      fi
    done
  done
}

already_enabled() {
  command -v omarchy >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  omarchy plugin list --json 2>/dev/null \
    | jq -e --arg id "$PLUGIN_ID" 'any(.[]; .id == $id and .enabled == true)' >/dev/null 2>&1
}

register_omarchy() {
  if ! command -v omarchy >/dev/null 2>&1; then
    log "omarchy not found on PATH; skipping validate/enable"
    return
  fi
  # Rescanning from inside the running service would reload this installer.
  if ! $IF_NEEDED; then
    omarchy plugin validate "$PROJECT_DIR"
    omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  fi
  if $ENABLE && ! already_enabled; then
    omarchy plugin enable "$PLUGIN_ID" right >/dev/null 2>&1 || true
  fi
}

main() {
  if $SKILLS_STATUS; then
    skills_status
    exit 0
  fi
  if $IF_NEEDED && setup_complete; then
    exit 0
  fi
  log "plugin dir: $PROJECT_DIR"
  write_connection
  install_plugin_link
  install_cli
  install_desktop
  remove_old_menu
  if $SKILLS; then install_skills; fi
  register_omarchy
  log "done. Click the Servarr icon on the bar and open Settings to connect."
}

main "$@"
