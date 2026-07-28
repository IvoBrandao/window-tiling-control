#!/usr/bin/env bash
#
# nested-dev.sh — run Window Tiling Control inside an ISOLATED nested GNOME Shell.
#
# Why: this extension can crash/break the Shell. A nested Shell runs the whole
# GNOME session inside a single window on your current desktop. If it crashes,
# only that window dies — your real session is untouched, no logout required.
#
# Isolation: we point XDG_{DATA,CONFIG,STATE,CACHE}_HOME at a throwaway sandbox
# so enabling the extension (and any dconf changes it makes) never leak into
# your real session's settings.
#
# Usage:
#   scripts/nested-dev.sh              # build, install into sandbox, launch
#   RES=1920x1080 scripts/nested-dev.sh
#   scripts/nested-dev.sh --clean      # wipe the sandbox and exit
#
set -euo pipefail

UUID="window-tiling-control@gnome-tiling"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${SANDBOX:-/tmp/wtc-nested-sandbox}"
RES="${RES:-1600x900}"

if [[ "${1:-}" == "--clean" ]]; then
  rm -rf "$SANDBOX"
  echo "Wiped $SANDBOX"
  exit 0
fi

if ! command -v gnome-shell >/dev/null 2>&1; then
  echo "gnome-shell not found. Install it (make setup-tools)." >&2
  exit 1
fi

echo "→ Building extension…"
make -C "$REPO" build >/dev/null

# Fresh, isolated XDG home so nothing touches your real session.
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_STATE_HOME="$SANDBOX/state"
export XDG_CACHE_HOME="$SANDBOX/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
echo "→ Installing into sandbox: $EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r "$REPO/build/$UUID/." "$EXT_DIR/"

export GSETTINGS_SCHEMA_DIR="$EXT_DIR/schemas"

echo "→ Launching nested GNOME Shell (${RES}). Close the window to exit."
echo "  ------------------------------------------------------------------"

# A dummy monitor of the requested size; nested Wayland session on its own bus.
export MUTTER_DEBUG_DUMMY_MODE_SPECS="$RES"

# IMPORTANT: the dconf writes that ENABLE the extension must run INSIDE the
# nested session's D-Bus, otherwise dconf talks to your real session's dconf
# service and the writes never reach the sandbox — the nested shell then starts
# with nothing enabled. So we run them, then exec gnome-shell, all in one
# dbus-run-session. UUID is exported so the inner shell expands it at runtime.
export UUID
exec dbus-run-session -- bash -c '
    dconf write /org/gnome/shell/disable-user-extensions false
    dconf write /org/gnome/shell/disable-extension-version-validation true
    dconf write /org/gnome/shell/enabled-extensions "['\''$UUID'\'']"
    exec gnome-shell --nested --wayland
'
