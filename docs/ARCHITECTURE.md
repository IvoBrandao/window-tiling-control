# Architecture

Window Tiling Control is a GNOME Shell extension (Shell 45–50) that adds
Windows‑11‑style snap zones and i3‑style keyboard tiling. This document describes
how the code is organised and how the main flows work.

## Layout

```
extension.js          Entry point + controller (wires everything, owns lifecycle)
prefs.js              Preferences window (Adw/GTK4)
metadata.json         Extension manifest (uuid, shell-version 45–50)
stylesheet.css        Styling for all overlays/HUDs
schemas/              GSettings schema (main + .keybindings child) + compiled
po/ , locale          Translations
src/                  All runtime modules (see below)
tests/                Node.js unit tests with a gi:// mock loader
scripts/nested-dev.sh Run the extension in an isolated nested GNOME Shell
```

### `src/` modules

| Module | Responsibility |
|---|---|
| `settings.js` | Typed accessors over the two GSettings schemas |
| `logger.js` | Level-filtered logging |
| `compat.js` | GNOME 45–50 API differences (`makeRect`, maximize flags, …) |
| `i18n.js` | gettext wrapper |
| `animations.js` | Clutter `ease()` helpers; honours the animations toggle + speed |
| `layoutPresets.js` | The 8 built-in presets as normalized rects |
| `zoneManager.js` | Normalized zones → pixel rects (gaps, workarea, cache); applies snaps |
| `customZones.js` | Persisted user zone sets (CRUD over GSettings) |
| `multiMonitor.js` | Per‑monitor+workspace active preset, cross‑monitor moves |
| `windowTracker.js` | Which window is in which zone; groups; resize propagation; persistence |
| `snapGroups.js` | Panel button + popup listing snap groups |
| `dragDetector.js` | Grab‑op + pointer polling → `zone-hovered` / `zone-selected` |
| `zoneHighlight.js` | Draws zone preview actors during drag; performs the snap on select |
| `snapOverlay.js` | `Super+Z` layout picker |
| `snapAssist.js` | Thumbnail pickers for remaining zones after a snap |
| `zoneEditor.js` | `Super+E` draw‑to‑create zone editor (workarea space) |
| `maximizeHook.js` | Intercepts a maximize → opens the layout picker |
| `roundedCorners.js` | Optional rounded window corners (GLSL effect) |
| `directionalMove.js` | Pure i3 movement model (slots + layout‑aware neighbours) |
| `keybindings.js` | Registers every keybinding → controller method |
| `resizeMode.js` | `Super+R` keyboard resize submode (modal grab) |
| `shortcutsCheatsheet.js` | Hold‑to‑show shortcut cheat sheet |
| `indicator.js` | Quick‑settings toggle |

## Lifecycle

`extension.js` splits startup in two to avoid blocking login:

1. **`enable()`** builds only lightweight services (settings, logger, animations,
   zone manager, multi‑monitor) synchronously.
2. A `GLib.idle_add` runs **`_enableDeferred()`** once the shell settles, creating
   the window tracker, drag/overlay/assist/editor subsystems, the maximize hook,
   keybindings, cheat sheet, resize mode and indicator. The idle body is wrapped
   so a failure self‑`disable()`s instead of crashing the shell.

`disable()` tears everything down in reverse and restores the GNOME tiling
keybindings that were overridden.

**Robustness conventions** (all subsystems follow these):
- `enable()`/`disable()` are idempotent (guard flag) — session‑mode changes may
  re‑invoke them.
- Every persistent GObject signal / GLib source is tracked and removed on
  teardown; timeouts return `GLib.SOURCE_REMOVE`.
- Bodies of hot raw callbacks (drag poll, size‑changed, per‑window signals) are
  wrapped in try/catch, since they run outside the extension error boundary.

## Key flows

**Drag to snap.** `dragDetector` watches `grab-op-begin/end` and, during a move,
polls the pointer every 16 ms. Edge/corner proximity selects a zone, which must
*dwell* ~160 ms before it activates (no flicker). It emits `zone-hovered`
(preview) and, on drop, `zone-selected`. `zoneHighlight` draws the preview and
calls `windowTracker.snapWindow(...)`. Rects come from `zoneManager` so gaps are
consistent. Dragging to the top previews and applies a maximize.

**Layout picker + snap assist.** `Super+Z` (`snapOverlay`) or the maximize hook
opens the picker; choosing a layout sets it active for the monitor and snaps.
After a snap into a multi‑zone layout, `snapAssist` shows window thumbnails over
the empty zones (armed briefly so the snap's own focus change doesn't dismiss it).

**Directional move / focus.** `Super+Arrow` = move. For halves/quarters it uses
the pure slot model in `directionalMove.js`; for any other layout it navigates
the active preset's real zones by edge‑adjacency (`neighborZoneIndex`), swapping
occupants. `Super+Alt+Arrow` = focus the nearest window in that direction.

**Resize mode.** `Super+R` (`resizeMode`) pushes a modal grab; arrow keys resize
the focused window. Snapped neighbours that share the moved edge follow via
`windowTracker`'s `size-changed` → `_propagateResize`.

**Gaps.** `zoneManager._normToPixel` applies edge‑aware gaps: workarea‑boundary
edges get the outer gap, shared edges get half the inner gap, so inner and outer
gaps are independent and symmetric.

**Persistence (opt‑in).** With *Remember Apps Across Relaunch* on, `windowTracker`
records `appId → {preset, zone, monitor}` in GSettings and re‑snaps an app on
launch if that zone is free; dragging a window away forgets it.

## Settings

Two schemas under `org.gnome.shell.extensions.window-tiling-control`: the main
schema (toggles, gaps, animations, colors, persistence) and a `.keybindings`
child. `settings.js` reads keys defensively (`_get`) so a stale installed schema
degrades to defaults instead of throwing. There are 33 keybindings.

## GNOME compatibility

`compat.js` centralises the 45→50 API differences. `metadata.json` lists all
supported versions; the nested‑Shell runner is the quickest way to smoke‑test a
new GNOME release before bumping the list.

## Testing

- **Unit tests** — `npm test` runs Node's test runner with a `gi://` mock loader
  (`tests/mocks/`), so pure logic (zone math, directional model, tracker,
  keybindings, gaps, persistence) runs without a live shell.
- **Nested Shell** — `scripts/nested-dev.sh` builds, installs into a throwaway
  sandbox (isolated `XDG_*`), and launches GNOME Shell in a window with the
  extension enabled. A crash there stays contained to that window — no logout.
```bash
npm test
./scripts/nested-dev.sh          # test live, isolated
```
