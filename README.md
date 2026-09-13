<p align="center">
  <img src="assets/logo.svg" alt="Window Tiling Control" width="140" height="140">
</p>

<h1 align="center">Window Tiling Control for GNOME</h1>

A GNOME Shell extension (45–50) that brings window snap zones to the Linux desktop.
Drag windows to screen edges, use i3-inspired keyboard shortcuts, or draw your own custom zone layouts.

## Features

- **Drag-to-edge snapping** — drag a window to a screen corner for quarter tiling, to a side for half tiling, or to the top to maximize
- **Snap layout picker** (`Super+Z`) — visual overlay to choose from 8 built-in presets (halves, thirds, quarters, sixths, wide-left/right, and more)
- **i3-style keybindings** — `Super+arrows` for tiling, `Super+U/I/J/K` for direct quarter placement, `Super+Shift` for move/swap. Movement is **layout-aware** — it navigates the active layout's real zones, not just a quarters grid
- **i3-style directional focus** — `Super+Alt+arrows` focuses the nearest window in that direction
- **Keyboard resize mode** (`Super+R`) — arrow keys resize the focused window (and its snapped neighbours); `Shift` for fine steps, `Esc` to exit
- **Shortcut cheat sheet** (`Super+/`) — hold to show every shortcut, release to dismiss
- **Custom zone editor** (`Super+E`) — full-screen draw-to-create zone editor with snap-to-grid, handle resizing, and save/load
- **Snap assist** — after snapping a window, shows thumbnails of remaining windows to fill empty zones
- **Snap groups** — remembers groups of tiled windows and offers one-click restore from the panel; optionally **re-snap apps across relaunch**
- **Multi-monitor support** — per-monitor presets, cross-monitor window movement (`Super+Ctrl+arrows`)
- **Configurable gaps** — independent inner (between windows) and outer (screen-edge) gaps
- **Configurable animations** — master on/off toggle plus speed control
- **Auto-tile** (`Super+Shift+T`) — tiles all visible windows into the active layout grid
- **Focus cycling** (`Super+Tab`) — cycles keyboard focus between tiled windows

## Installation

### From Source

```bash
git clone https://github.com/IvoBrandao/window-tiling-control.git
cd window-tiling-control
make install
```

Then restart GNOME Shell:

- **X11:** `Alt+F2` → type `r` → Enter
- **Wayland:** Log out and log back in

Enable the extension:

```bash
gnome-extensions enable window-tiling-control@gnome-tiling
```

### Dependencies

- GNOME Shell 45, 46, 47, 48, 49 or 50
- `glib-compile-schemas` (part of `glib2` / `libglib2.0-dev`)
- `gettext` (for translations, optional)

## Default Keybindings

All shortcuts are customizable in the extension preferences. Six additional
"Snap to Zone 1–6" shortcuts exist for jumping straight to a specific zone of
the active layout; they ship unbound and can be assigned from the
**Keybindings → Advanced: Direct Zone Snap** section of the preferences
window.

### Window Tiling

| Shortcut | Action |
|---|---|
| `Super+Left` | Tile left half (or navigate quarter left) |
| `Super+Right` | Tile right half (or navigate quarter right) |
| `Super+Up` | Tile upper quarter (or navigate quarter up) |
| `Super+Down` | Tile lower quarter (or navigate quarter down) |

### Direct Quarter Placement

| Shortcut | Action |
|---|---|
| `Super+U` | Top-left quarter |
| `Super+I` | Top-right quarter |
| `Super+J` | Bottom-left quarter |
| `Super+K` | Bottom-right quarter |

### Move / Swap

| Shortcut | Action |
|---|---|
| `Super+Shift+Left` | Move/swap window left |
| `Super+Shift+Right` | Move/swap window right |
| `Super+Shift+Up` | Move/swap window up |
| `Super+Shift+Down` | Move/swap window down |

### Directional Focus (i3-style)

| Shortcut | Action |
|---|---|
| `Super+Alt+Left` | Focus nearest window to the left |
| `Super+Alt+Right` | Focus nearest window to the right |
| `Super+Alt+Up` | Focus nearest window above |
| `Super+Alt+Down` | Focus nearest window below |

### Focus, Layout & Modes

| Shortcut | Action |
|---|---|
| `Super+Tab` | Cycle focus between tiled windows |
| `Super+Shift+T` | Auto-tile all visible windows |
| `Super+R` | Toggle keyboard resize mode |
| `Super+/` | Hold to show the shortcut cheat sheet |
| `Super+Z` | Open snap layout picker |
| `Super+E` | Open zone editor |
| `Super+]` | Cycle to next preset |
| `Super+[` | Cycle to previous preset |
| `Super+Shift+G` | Restore snap group |

### Monitor Movement

| Shortcut | Action |
|---|---|
| `Super+Ctrl+Left` | Move window to left monitor |
| `Super+Ctrl+Right` | Move window to right monitor |

## Configuration

Open the extension preferences from GNOME Extensions or the Quick Settings menu. The settings panel has five pages:

1. **General** — master enable switch, window gap size, drag edge threshold, log level
2. **Features** — toggle snap overlay, snap assist, drag zone highlights, snap groups
3. **Appearance** — animation speed, snap assist timeout, zone highlight colors
4. **Keybindings** — customize all shortcuts with grouped categories, conflict warnings, and a reset button
5. **Layouts** — manage saved custom zone layouts and the zone editor's snap-to-grid density

## Built-in Layout Presets

| Preset | Zones | Description |
|---|---|---|
| Halves | 2 | Left/right 50-50 split |
| Thirds | 3 | Three equal columns (wide monitors) |
| Wide Left | 2 | 2/3 left + 1/3 right |
| Wide Right | 2 | 1/3 left + 2/3 right |
| Quarters | 4 | Four equal quadrants |
| Half + Quarters | 3 | Left half + two right quarters |
| Sixths | 6 | 3×2 grid (ultra-wide monitors) |
| Top Thirds | 3 | Two top quarters + full bottom (portrait) |

## Development

### Project Structure

```
extension.js          Main extension entry point (WindowTilingControlController)
prefs.js              Adw-based preferences UI (5 pages)
metadata.json         Extension metadata
stylesheet.css        CSS for all overlays and highlights
src/
  settings.js         Typed GSettings accessors
  layoutPresets.js    8 built-in zone presets (normalized rects)
  zoneManager.js      Normalized → pixel rect conversion + window assignment
  customZones.js      Custom zone set CRUD (stored in GSettings)
  dragDetector.js     Grab-op signal detection + 16ms pointer polling
  zoneHighlight.js    Zone overlay rendering during drag
  snapOverlay.js      Super+Z layout picker popup
  snapAssist.js       Post-snap window thumbnail picker
  snapGroups.js       Snap group tracking + panel button
  windowTracker.js    Snapped window state management
  zoneEditor.js       Drag-to-draw custom zone editor
  keybindings.js      21 keyboard shortcuts (i3-inspired defaults)
  indicator.js        Quick Settings toggle + submenu
  multiMonitor.js     Per-monitor preset management
  maximizeHook.js     Maximize button → snap overlay redirect
  animations.js       Fade/scale/slide animation helpers
  compat.js           GNOME 45-49 API compatibility layer
  i18n.js             Gettext translation helpers
  logger.js           Configurable log levels
```

### Running Tests

```bash
npm test
# or directly:
node --test --import ./tests/mocks/gi.js tests/*.test.js
```

### Build Commands

```bash
make schemas    # Compile GSettings schemas
make po         # Compile translations
make build      # Create full build in ./build/
make install    # Install to ~/.local/share/gnome-shell/extensions/
make dist       # Create distributable .zip
make test       # Run test suite
make clean      # Remove build artifacts
```

## Compatibility

WindowTilingControl handles GNOME API changes across versions automatically:

| API Change | GNOME Version | Handled In |
|---|---|---|
| `Meta.Rectangle` → `Mtk.Rectangle` | 46+ | `compat.js` |
| `get_maximized()` → `get_maximize_flags()` | 49+ | `compat.js` |
| `monitors-changed` signal moved | 46+ | `multiMonitor.js` |
| `captured-event` signal removed | 47+ | `zoneEditor.js`, `snapOverlay.js` |
| `event.get_source()` removed | 47+ | `zoneEditor.js` |
| `grab-op-begin` parameter change | 46+ | `dragDetector.js` |

## Translations

Translations are available for: German, Spanish, French, Italian, and Portuguese.

To add a new translation:

```bash
# Generate the template
make pot

# Copy template and translate
cp po/window-tiling-control.pot po/XX.po
# Edit po/XX.po with your translations

# Add the locale code to Makefile LOCALES variable
# Then rebuild
make po && make install
```

## License

See the repository for license details.
