/**
 * WindowTilingControl — src/keybindings.js
 * Registers all configurable keybindings via Main.wm.addKeybinding.
 *
 * Keybinding names must exactly match the keys declared under the
 * org.gnome.shell.extensions.window-tiling-control.keybindings GSettings child schema.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

/** Keybinding name → handler builder (receives controller reference). */
const KB_DEFS = [
    {
        name: "snap-left-half",
        handler: c => () => c.snapFocusedLeft(),
    },
    {
        name: "snap-right-half",
        handler: c => () => c.snapFocusedRight(),
    },
    {
        name: "snap-upper-quarter",
        handler: c => () => c.snapFocusedToUpperQuarter(),
    },
    {
        name: "snap-lower-quarter",
        handler: c => () => c.snapFocusedToLowerQuarter(),
    },
    {
        name: "snap-top-left",
        handler: c => () => c.snapFocusedToPreset("quarters", 0),
    },
    {
        name: "snap-top-right",
        handler: c => () => c.snapFocusedToPreset("quarters", 1),
    },
    {
        name: "snap-bottom-left",
        handler: c => () => c.snapFocusedToPreset("quarters", 2),
    },
    {
        name: "snap-bottom-right",
        handler: c => () => c.snapFocusedToPreset("quarters", 3),
    },
    {
        name: "open-snap-overlay",
        handler: c => () => c.toggleSnapOverlay(),
    },
    {
        name: "open-zone-editor",
        handler: c => () => c.openZoneEditor(),
    },
    {
        name: "move-monitor-left",
        handler: c => () => c.moveFocusedToMonitor(Meta.DisplayDirection.LEFT),
    },
    {
        name: "move-monitor-right",
        handler: c => () => c.moveFocusedToMonitor(Meta.DisplayDirection.RIGHT),
    },
    {
        name: "move-swap-left",
        handler: c => () => c.moveSwapFocused("left"),
    },
    {
        name: "move-swap-right",
        handler: c => () => c.moveSwapFocused("right"),
    },
    {
        name: "move-swap-up",
        handler: c => () => c.moveSwapFocused("up"),
    },
    {
        name: "move-swap-down",
        handler: c => () => c.moveSwapFocused("down"),
    },
    {
        name: "focus-cycle-tiled",
        handler: c => () => c.focusCycleTiled(),
    },
    {
        name: "show-shortcuts",
        handler: c => () => c.showShortcutsCheatsheet(),
    },
    {
        name: "toggle-resize-mode",
        handler: c => () => c.toggleResizeMode(),
    },
    {
        name: "focus-left",
        handler: c => () => c.focusDirection("left"),
    },
    {
        name: "focus-right",
        handler: c => () => c.focusDirection("right"),
    },
    {
        name: "focus-up",
        handler: c => () => c.focusDirection("up"),
    },
    {
        name: "focus-down",
        handler: c => () => c.focusDirection("down"),
    },
    // Direct zone snap (unbound by default; snaps into the active preset's zone).
    ...[1, 2, 3, 4, 5, 6].map(n => ({
        name: `snap-to-zone-${n}`,
        handler: c => () => c.snapFocusedToActiveZone(n - 1),
    })),
    {
        name: "auto-tile-grid",
        handler: c => () => c.autoTileToGrid(),
    },
    {
        name: "cycle-preset-next",
        handler: c => () => c.cyclePreset(1),
    },
    {
        name: "cycle-preset-prev",
        handler: c => () => c.cyclePreset(-1),
    },
    {
        name: "restore-snap-group",
        handler: c => () => c.restoreLastSnapGroup(),
    },
];

export class Keybindings {
    constructor(settings, controller, logger) {
        this._settings = settings;
        this._controller = controller;
        this._log = logger;

        /** @type {string[]} */
        this._registered = [];
    }

    enable() {
        // Idempotent: enable() may be re-invoked on session-mode changes.
        if (this._registered.length > 0) return;

        const kbSettings = this._settings.kbSettings;

        for (const def of KB_DEFS) {
            try {
                Main.wm.addKeybinding(
                    def.name,
                    kbSettings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    def.handler(this._controller)
                );
                this._registered.push(def.name);
            } catch (e) {
                this._log?.warn(`Keybindings: failed to register "${def.name}": ${e.message}`);
            }
        }

        this._log?.info(`Keybindings: registered ${this._registered.length} bindings`);
    }

    disable() {
        for (const name of this._registered) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                this._log?.warn(`Keybindings: failed to remove "${name}": ${e.message}`);
            }
        }
        this._registered = [];
    }
}
