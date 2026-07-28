/**
 * WindowTilingControl — Window Snap Zones for GNOME
 * extension.js — Main extension entry point and controller lifecycle
 *
 * GNOME Shell 45-49 compatible (ESM imports)
 */

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { Settings } from "./src/settings.js";
import { Logger } from "./src/logger.js";
import { setExtensionObject } from "./src/i18n.js";
import { Animations } from "./src/animations.js";
import { ZoneManager } from "./src/zoneManager.js";
import { CustomZoneStore } from "./src/customZones.js";
import { MultiMonitorManager } from "./src/multiMonitor.js";
import { WindowTracker } from "./src/windowTracker.js";
import { SnapGroupsManager } from "./src/snapGroups.js";
import { DragDetector } from "./src/dragDetector.js";
import { ZoneHighlighter } from "./src/zoneHighlight.js";
import { SnapOverlay } from "./src/snapOverlay.js";
import { SnapAssist } from "./src/snapAssist.js";
import { ZoneEditor } from "./src/zoneEditor.js";
import { MaximizeHook } from "./src/maximizeHook.js";
import { RoundedCorners } from "./src/roundedCorners.js";
import { Keybindings } from "./src/keybindings.js";
import { Indicator } from "./src/indicator.js";
import { ShortcutsCheatsheet } from "./src/shortcutsCheatsheet.js";
import { ResizeMode } from "./src/resizeMode.js";
import { classifySlot, resolveMove, slotFromEntry, zoneIndexForRect, neighborZoneIndex } from "./src/directionalMove.js";

// ---------------------------------------------------------------------------

export default class WindowTilingControlExtension extends Extension {
    enable() {
        this._controller = new WindowTilingControlController(this);
        this._controller.enable();
    }

    disable() {
        if (this._controller) {
            this._controller.disable();
            this._controller = null;
        }
    }
}

// ---------------------------------------------------------------------------

class WindowTilingControlController {
    constructor(extension) {
        this._ext = extension;
    }

    enable() {
        // Phase 1 — core services (lightweight, runs synchronously)
        this._settings = new Settings(this._ext);
        this._logger = new Logger(this._settings);
        setExtensionObject(this._ext);
        this._animations = new Animations(this._settings);

        this._logger.info("WindowTilingControl enabling…");

        // Phase 2 — zone logic (lightweight)
        this._customZones = new CustomZoneStore(this._settings, this._logger);
        this._zoneManager = new ZoneManager(this._settings, this._customZones, this._logger);

        // Phase 3 — monitor awareness (lightweight)
        this._multiMonitor = new MultiMonitorManager(this._settings, this._zoneManager, this._logger);
        this._multiMonitor.enable();

        // Phases 4-12 are deferred to avoid blocking shell startup.
        // This prevents the "every program locks for a while on login" issue.
        this._deferredInitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._deferredInitId = null;
            if (!this._settings) return GLib.SOURCE_REMOVE; // disabled before idle fired
            // CRITICAL: this runs inside a GLib idle callback, which is NOT
            // wrapped by GNOME's extension-manager error handling. An uncaught
            // throw here would propagate into the main loop and crash the whole
            // session. Guard it so a broken subsystem degrades gracefully.
            try {
                this._enableDeferred();
            } catch (e) {
                this._logger?.error(`WindowTilingControl deferred init failed: ${e}\n${e?.stack ?? ""}`);
                try { this.disable(); } catch (_) {}
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Deferred initialisation — runs after the shell has finished its own
     * startup processing so we don't block window rendering.
     */
    _enableDeferred() {
        // Phase 4 — window state
        this._windowTracker = new WindowTracker(
            this._settings, this._zoneManager, this._multiMonitor, this._logger
        );
        this._windowTracker.enable();

        // Phase 5 — snap groups
        this._snapGroups = new SnapGroupsManager(
            this._settings, this._windowTracker, this._animations, this._logger
        );
        this._snapGroups.enable();

        // Phase 6 — drag + highlights
        this._dragDetector = new DragDetector(
            this._settings, this._zoneManager, this._multiMonitor, this._logger
        );
        this._dragDetector.enable();

        this._zoneHighlighter = new ZoneHighlighter(
            this._settings, this._dragDetector, this._windowTracker,
            this._zoneManager, this._animations, this._logger
        );
        this._zoneHighlighter.enable();

        // Phase 7 — snap overlay (Super+Z)
        this._snapOverlay = new SnapOverlay(
            this._settings, this._zoneManager, this._customZones, this._multiMonitor,
            this._windowTracker, this._zoneHighlighter, this._animations, this._logger
        );

        // Phase 8 — snap assist
        this._snapAssist = new SnapAssist(
            this._settings, this._windowTracker, this._zoneManager,
            this._animations, this._logger
        );
        this._windowTracker.setSnapAssist(this._snapAssist);

        // Refresh the snap-groups panel button whenever windows snap/unsnap.
        this._windowTracker.setChangeListener(() => this._snapGroups?.refresh());

        // Phase 9 — zone editor
        this._zoneEditor = new ZoneEditor(
            this._settings, this._customZones, this._zoneManager,
            this._animations, this._logger
        );

        // Phase 10 — maximize-button intercept (maximize → snap overlay)
        this._maximizeHook = new MaximizeHook(this._settings, this._snapOverlay, this._logger);
        this._maximizeHook.enable();

        // Phase 10b — rounded window corners (opt-in via settings)
        this._roundedCorners = new RoundedCorners(this._settings, this._logger);
        this._roundedCorners.enable();

        // Phase 11 — disable GNOME native tiling (must happen BEFORE our keybindings)
        this._overrideGnomeTiling();

        // Phase 12 — keybindings (this controller is the handler target)
        this._keybindings = new Keybindings(this._settings, this, this._logger);
        this._keybindings.enable();

        // Phase 12b — keyboard shortcuts cheat sheet (hold-to-show)
        this._cheatsheet = new ShortcutsCheatsheet(this._settings, this._logger);

        // Phase 12c — keyboard resize submode
        this._resizeMode = new ResizeMode(
            this._settings, this._windowTracker, this._zoneManager, this._logger
        );

        // Phase 13 — quick settings indicator
        this._indicator = new Indicator(this._settings, this, this._logger);
        this._indicator.enable();

        // Session mode handling (lock screen)
        this._wasLocked = false;
        this._sessionSignalId = Main.sessionMode.connect(
            "updated",
            this._onSessionModeUpdated.bind(this)
        );

        // Overview handling — hide popups when activities open
        this._overviewShowId = Main.overview.connect(
            "showing",
            this._onOverviewShowing.bind(this)
        );

        // Watch master enable/disable toggle
        this._enabledSignalId = this._settings.connect(
            "changed::tiling-enabled",
            this._onEnabledChanged.bind(this)
        );

        // If the toggle was already OFF before deferred init ran,
        // soft-disable now so we don't leave GNOME settings overridden.
        if (!this._settings.enabled) {
            this._onEnabledChanged();
        }

        this._logger.info("WindowTilingControl enabled");
    }

    disable() {
        this._logger?.info("WindowTilingControl disabling…");

        // Cancel deferred init if it hasn't run yet
        if (this._deferredInitId) {
            GLib.Source.remove(this._deferredInitId);
            this._deferredInitId = null;
        }

        if (this._sessionSignalId) {
            Main.sessionMode.disconnect(this._sessionSignalId);
            this._sessionSignalId = null;
        }
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }
        if (this._enabledSignalId) {
            this._settings.disconnect(this._enabledSignalId);
            this._enabledSignalId = null;
        }

        // Reverse order
        this._resizeMode?.destroy();
        this._cheatsheet?.destroy();
        this._indicator?.disable();
        this._keybindings?.disable();
        this._restoreGnomeTiling();
        this._maximizeHook?.disable();
        this._roundedCorners?.disable();
        this._zoneEditor?.destroy();
        this._snapAssist?.destroy();
        this._snapOverlay?.destroy();
        this._zoneHighlighter?.disable();
        this._dragDetector?.disable();
        this._snapGroups?.disable();
        this._windowTracker?.disable();
        this._multiMonitor?.disable();
        this._zoneManager?.destroy();

        this._resizeMode = null;
        this._cheatsheet = null;
        this._indicator = null;
        this._keybindings = null;
        this._maximizeHook = null;
        this._roundedCorners = null;
        this._zoneEditor = null;
        this._snapAssist = null;
        this._snapOverlay = null;
        this._zoneHighlighter = null;
        this._dragDetector = null;
        this._snapGroups = null;
        this._windowTracker = null;
        this._multiMonitor = null;
        this._zoneManager = null;
        this._customZones = null;
        this._animations = null;
        this._settings = null;
        this._logger = null;
    }

    _onSessionModeUpdated(sessionMode) {
        const isLocked = sessionMode.currentMode === "unlock-dialog" ||
                         sessionMode.parentMode === "unlock-dialog";

        // "updated" fires on every session-mode change, not just lock/unlock;
        // only act on an actual locked-state transition.
        if (isLocked === this._wasLocked) return;
        this._wasLocked = isLocked;

        if (isLocked) {
            this._keybindings?.disable();
            this._indicator?.hide();
            this._snapOverlay?.close();
            this._snapAssist?.destroyAll();
            this._dragDetector?.disable();
            this._maximizeHook?.disable();
        } else {
            this._keybindings?.enable();
            this._indicator?.show();
            this._dragDetector?.enable();
            this._maximizeHook?.enable();
        }
    }

    _onOverviewShowing() {
        this._snapOverlay?.close();
        this._snapAssist?.destroyAll();
        this._zoneEditor?.close();
        this._zoneHighlighter?.clearAll();
        this._cheatsheet?.close();
        this._resizeMode?.exit();
    }

    /**
     * Hold-to-show keyboard cheat sheet. Also closes any other transient overlay
     * so two full-screen popups can't fight for input.
     */
    showShortcutsCheatsheet() {
        if (!this._cheatsheet) return;
        this._snapOverlay?.close();
        this._snapAssist?.destroyAll();
        this._zoneEditor?.close();
        this._resizeMode?.exit();
        this._cheatsheet.open();
    }

    /** Toggle the i3-style keyboard resize submode. */
    toggleResizeMode() {
        if (!this._resizeMode) return;
        this._cheatsheet?.close();
        this._snapOverlay?.close();
        this._resizeMode.toggle();
    }

    _onEnabledChanged() {
        const enabled = this._settings.enabled;
        this._logger?.info(`WindowTilingControl ${enabled ? "re-enabled" : "soft-disabled"} via settings`);

        if (enabled) {
            this._overrideGnomeTiling();
            this._keybindings?.enable();
            this._dragDetector?.enable();
            this._maximizeHook?.enable();
            this._indicator?.show();
        } else {
            // Close any open overlays
            this._snapOverlay?.close();
            this._snapAssist?.destroyAll();
            this._zoneEditor?.close();
            this._zoneHighlighter?.clearAll();
            // Disable subsystems
            this._keybindings?.disable();
            this._dragDetector?.disable();
            this._maximizeHook?.disable();
            this._indicator?.hide();
            // Restore GNOME native tiling
            this._restoreGnomeTiling();
        }
    }

    // ------------------------------------------------------------------ GNOME native tiling override

    /**
     * Disable GNOME's built-in tiling keybindings and edge-tiling so they
     * don't conflict with WindowTilingControl.  Saves original values for restore.
     */
    _overrideGnomeTiling() {
        // Bail if already overridden, so we never overwrite the saved originals.
        if (this._savedGnomeBindings) return;
        this._savedGnomeBindings = {};

        // 1. Disable edge-tiling (drag-to-edge tiling)
        try {
            this._mutterSettings = new Gio.Settings({ schema_id: "org.gnome.mutter" });
            this._savedGnomeBindings["edge-tiling"] = this._mutterSettings.get_boolean("edge-tiling");
            this._mutterSettings.set_boolean("edge-tiling", false);
            this._logger?.debug("Disabled GNOME edge-tiling");
        } catch (e) {
            this._logger?.debug(`Could not override edge-tiling: ${e.message}`);
        }

        // 2. Disable conflicting WM keybindings (Super+Up=maximize, Super+Down=unmaximize)
        try {
            this._wmSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings" });
            for (const key of ["maximize", "unmaximize"]) {
                try {
                    this._savedGnomeBindings[`wm:${key}`] = this._wmSettings.get_strv(key);
                    this._wmSettings.set_strv(key, []);
                } catch (_) {}
            }
            this._logger?.debug("Disabled GNOME maximize/unmaximize keybindings");
        } catch (e) {
            this._logger?.debug(`Could not override WM keybindings: ${e.message}`);
        }

        // 3. Disable Mutter tile-left/tile-right (Super+Left/Right)
        try {
            this._mutterKbSettings = new Gio.Settings({ schema_id: "org.gnome.mutter.keybindings" });
            for (const key of ["toggle-tiled-left", "toggle-tiled-right"]) {
                try {
                    this._savedGnomeBindings[`mutter:${key}`] = this._mutterKbSettings.get_strv(key);
                    this._mutterKbSettings.set_strv(key, []);
                } catch (_) {}
            }
            this._logger?.debug("Disabled GNOME tile-left/tile-right keybindings");
        } catch (e) {
            this._logger?.debug(`Could not override Mutter keybindings: ${e.message}`);
        }
    }

    /**
     * Restore GNOME's original tiling settings saved by _overrideGnomeTiling.
     */
    _restoreGnomeTiling() {
        if (!this._savedGnomeBindings) return;

        try {
            if (this._mutterSettings && this._savedGnomeBindings["edge-tiling"] !== undefined) {
                this._mutterSettings.set_boolean("edge-tiling", this._savedGnomeBindings["edge-tiling"]);
            }
        } catch (_) {}

        try {
            if (this._wmSettings) {
                for (const key of ["maximize", "unmaximize"]) {
                    const saved = this._savedGnomeBindings[`wm:${key}`];
                    if (saved) this._wmSettings.set_strv(key, saved);
                }
            }
        } catch (_) {}

        try {
            if (this._mutterKbSettings) {
                for (const key of ["toggle-tiled-left", "toggle-tiled-right"]) {
                    const saved = this._savedGnomeBindings[`mutter:${key}`];
                    if (saved) this._mutterKbSettings.set_strv(key, saved);
                }
            }
        } catch (_) {}

        this._savedGnomeBindings = null;
        this._mutterSettings = null;
        this._wmSettings = null;
        this._mutterKbSettings = null;

        // Flush to disk so the restored values survive a shell crash.
        try { Gio.Settings.sync(); } catch (_) {}

        this._logger?.debug("Restored GNOME native tiling settings");
    }

    // ------------------------------------------------------------------ public API (used by Keybindings)

    /**
     * Snap the focused window to a specific preset zone.
     * @param {string} presetId
     * @param {number} zoneIndex
     */
    snapFocusedToPreset(presetId, zoneIndex) {
        const win = global.display.get_focus_window();
        if (!win || !this._zoneManager) return;

        const monitorIndex = win.get_monitor();
        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex, this._settings.windowGapSize);
        const rect  = rects[zoneIndex];
        if (!rect) return;

        this._windowTracker.snapWindow(win, presetId, zoneIndex, rect);
    }

    /**
     * Snap a window to a target quarter, swapping with any occupant.
     * If the target quarter is occupied by another window, that window
     * moves to the current window's previous position.
     */
    _snapWithSwap(win, targetPreset, targetZone) {
        if (!this._zoneManager || !this._windowTracker) return;

        const monitorIndex = win.get_monitor();
        const rects = this._zoneManager.getZoneRects(targetPreset, monitorIndex, this._settings.windowGapSize);
        const targetRect = rects[targetZone];
        if (!targetRect) return;

        // Check for occupant at the target zone
        const occupant = this._windowTracker.getWindowAtZone(targetPreset, targetZone, monitorIndex);
        if (occupant && occupant !== win) {
            const currentEntry = this._windowTracker.getSnapEntry(win);
            if (currentEntry) {
                // Swap: move occupant to the current window's old position
                const srcRects = this._zoneManager.getZoneRects(
                    currentEntry.presetId, monitorIndex, this._settings.windowGapSize
                );
                const srcRect = srcRects[currentEntry.zoneIndex];
                if (srcRect) {
                    this._windowTracker.snapWindow(
                        occupant, currentEntry.presetId, currentEntry.zoneIndex, srcRect
                    );
                }
            }
        }

        this._windowTracker.snapWindow(win, targetPreset, targetZone, targetRect);
    }

    /**
     * Classify the focused window into a directional-movement slot based on its
     * ACTUAL geometry (not tracked state), so movement is reliable even for
     * windows we never snapped (dragged, GNOME-tiled, CSD apps, …).
     * @returns {"maxi"|"L"|"R"|"TL"|"TR"|"BL"|"BR"|null}
     */
    _classifySlot(win) {
        const wa = this._zoneManager?._getWorkarea(win.get_monitor());
        if (!wa) return null;
        return classifySlot(win.get_frame_rect(), wa);
    }

    /**
     * i3-style directional move: send the focused window to the neighbouring
     * zone in the given direction. Geometry-based and reversible.
     * @param {"left"|"right"|"up"|"down"} direction
     */
    _directionalMove(direction) {
        if (!this._windowTracker || !this._zoneManager) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const monitorIndex = win.get_monitor();
        const activePreset = this._multiMonitor?.getActivePreset(monitorIndex) ?? "halves";

        // Plain halves/quarters use the slot model (handles unsnapped windows
        // and edge-grow). Prefer the tracked entry over geometry so apps that
        // don't honour the requested size aren't misclassified.
        if (activePreset === "halves" || activePreset === "quarters") {
            const entry = this._windowTracker.getSnapEntry(win);
            const slot = slotFromEntry(entry) ?? this._classifySlot(win);
            const target = slot && resolveMove(slot, direction);
            if (!target) return; // no neighbour that way (outer edge) — no-op

            const [presetId, zoneIndex] = target;
            if (presetId === "quarters")
                this._snapWithSwap(win, "quarters", zoneIndex);
            else
                this.snapFocusedToPreset(presetId, zoneIndex);
            return;
        }

        // Any other preset: navigate the active layout's real zones by
        // edge-adjacency.
        const rects = this._zoneManager.getZoneRects(
            activePreset, monitorIndex, this._settings.windowGapSize
        );
        if (!rects.length) return;

        const entry = this._windowTracker.getSnapEntry(win);
        let curIdx = (entry && entry.presetId === activePreset) ? entry.zoneIndex : -1;
        if (curIdx < 0 || curIdx >= rects.length)
            curIdx = zoneIndexForRect(rects, win.get_frame_rect());

        const targetIdx = neighborZoneIndex(rects, curIdx, direction);
        if (targetIdx < 0 || targetIdx === curIdx) return; // outer edge — no-op

        this._snapWithSwapPreset(win, activePreset, curIdx, targetIdx, rects);
    }

    /**
     * Move `win` into targetZone of an arbitrary preset, swapping with any
     * occupant (which takes win's previous zone). Generic version of
     * _snapWithSwap that works for any preset + precomputed zone rects.
     */
    _snapWithSwapPreset(win, presetId, curZone, targetZone, rects) {
        const monitorIndex = win.get_monitor();
        const targetRect = rects[targetZone];
        if (!targetRect) return;

        const occupant = this._windowTracker.getWindowAtZone(presetId, targetZone, monitorIndex);
        if (occupant && occupant !== win && curZone >= 0 && rects[curZone]) {
            // Occupant takes the mover's old zone.
            this._windowTracker.snapWindow(occupant, presetId, curZone, rects[curZone]);
        }
        this._windowTracker.snapWindow(win, presetId, targetZone, targetRect);
    }

    snapFocusedLeft()  { this._directionalMove("left"); }
    snapFocusedRight() { this._directionalMove("right"); }

    snapFocusedToUpperQuarter() { this._directionalMove("up"); }
    snapFocusedToLowerQuarter() { this._directionalMove("down"); }

    /**
     * Super+Shift+Arrow: move/swap the focused window to the adjacent zone.
     * Uses the same geometry-based directional model as Super+Arrow so both
     * shortcuts behave consistently.
     * @param {string} direction - "left", "right", "up", "down"
     */
    moveSwapFocused(direction) {
        this._directionalMove(direction);
    }

    /**
     * i3-style directional FOCUS: move keyboard focus to the nearest window in
     * the given direction on the current workspace (across monitors). Chooses
     * the candidate whose centre lies furthest into `direction` with the least
     * perpendicular offset — the classic nearest-neighbour heuristic.
     *
     * @param {"left"|"right"|"up"|"down"} direction
     */
    focusDirection(direction) {
        if (!this._windowTracker) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const wsIndex = global.workspace_manager.get_active_workspace_index();
        const from = win.get_frame_rect();
        const fcx = from.x + from.width / 2;
        const fcy = from.y + from.height / 2;

        let best = null;
        let bestScore = Infinity;
        for (const w of this._windowTracker._getAllWindows()) {
            if (w === win || w.minimized || w.skip_taskbar) continue;
            const ws = w.get_workspace();
            if (!ws || ws.index() !== wsIndex) continue;

            const r = w.get_frame_rect();
            const dx = (r.x + r.width / 2) - fcx;
            const dy = (r.y + r.height / 2) - fcy;

            let along, across;
            switch (direction) {
                case "left":  if (dx >= 0) continue; along = -dx; across = Math.abs(dy); break;
                case "right": if (dx <= 0) continue; along =  dx; across = Math.abs(dy); break;
                case "up":    if (dy >= 0) continue; along = -dy; across = Math.abs(dx); break;
                case "down":  if (dy <= 0) continue; along =  dy; across = Math.abs(dx); break;
                default: return;
            }
            // Weight perpendicular offset so aligned neighbours win ties.
            const score = along + across * 2;
            if (score < bestScore) { bestScore = score; best = w; }
        }

        if (best) best.activate(global.get_current_time());
    }

    /**
     * Snap the focused window into a zone index of the monitor's ACTIVE preset.
     * Backs the (unbound by default) snap-to-zone-N keybindings, so they work
     * with whatever layout is active rather than being no-ops.
     * @param {number} zoneIndex - 0-based
     */
    snapFocusedToActiveZone(zoneIndex) {
        if (!this._multiMonitor) return;
        const win = global.display.get_focus_window();
        if (!win) return;
        const monitorIndex = win.get_monitor();
        const presetId = this._multiMonitor.getActivePreset(monitorIndex) ?? "halves";
        this.snapFocusedToPreset(presetId, zoneIndex);
    }

    toggleSnapOverlay() {
        const win = global.display.get_focus_window();
        if (!win || !this._snapOverlay) return;
        this._cheatsheet?.close();
        if (this._snapOverlay._widget)
            this._snapOverlay.close();
        else
            this._snapOverlay.open(win);
    }

    openZoneEditor() {
        if (!this._zoneEditor) return;
        this._cheatsheet?.close();
        // If the editor is already open, the same shortcut commits (saves)
        // the drawn layout instead of toggling it closed.
        if (this._zoneEditor.isOpen()) {
            this._zoneEditor.save();
            return;
        }
        const monitorIndex = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        this._zoneEditor.open(monitorIndex);
    }

    /**
     * Move the focused window (and its snap group) to an adjacent monitor.
     * @param {Meta.DisplayDirection|string} direction
     */
    moveFocusedToMonitor(direction) {
        const win = global.display.get_focus_window();
        if (!win || !this._multiMonitor) return;

        this._multiMonitor.moveWindowToMonitor(win, direction, newMonitorIndex => {
            const entry = this._windowTracker.getSnapEntry(win);
            if (entry) {
                const rects = this._zoneManager.getZoneRects(
                    entry.presetId, newMonitorIndex, this._settings.windowGapSize
                );
                const newRect = rects[entry.zoneIndex];
                if (newRect) {
                    this._windowTracker.snapWindow(win, entry.presetId, entry.zoneIndex, newRect);
                }
            }
            // Re-snap the entire group on the new monitor
            this._windowTracker.moveGroupToMonitor(win, newMonitorIndex);
        });
    }

    cyclePreset(direction) {
        if (!this._multiMonitor) return;
        const monitorIndex = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        this._multiMonitor.cyclePreset(monitorIndex, direction);
    }

    restoreLastSnapGroup() {
        if (!this._windowTracker) return;
        const groups = this._windowTracker.getActiveSnapGroups();
        if (groups.size === 0) return;
        const [key] = groups.keys();
        this._snapGroups.restoreGroup(key);
    }

    /**
     * Cycle keyboard focus to the next snapped window on the current
     * monitor+workspace.  Wraps around to the first window after the last.
     */
    focusCycleTiled() {
        if (!this._windowTracker) return;
        const currentWin = global.display.get_focus_window();
        if (!currentWin) return;

        const monitorIndex = currentWin.get_monitor();
        const wsIndex = global.workspace_manager.get_active_workspace_index();

        // Collect all snapped windows on this monitor+workspace, sorted by zone
        const snapped = [];
        for (const [windowId, entry] of this._windowTracker._snapped) {
            if (entry.monitorIndex === monitorIndex && entry.workspaceIndex === wsIndex) {
                const win = this._windowTracker._findWindowById(windowId);
                if (win) snapped.push({ win, entry });
            }
        }

        if (snapped.length === 0) return;

        // Sort by spatial position: top-to-bottom, left-to-right
        snapped.sort((a, b) => {
            const ay = a.entry.zoneRect?.y ?? 0;
            const by = b.entry.zoneRect?.y ?? 0;
            if (ay !== by) return ay - by;
            return (a.entry.zoneRect?.x ?? 0) - (b.entry.zoneRect?.x ?? 0);
        });

        // Find current window in list and advance
        const currentIdx = snapped.findIndex(s => s.win === currentWin);
        const nextIdx = (currentIdx + 1) % snapped.length;

        const nextWin = snapped[nextIdx].win;
        nextWin.activate(global.get_current_time());
    }

    /**
     * Auto-tile all visible, non-snapped windows into the active preset's
     * zones on the focused monitor.
     */
    autoTileToGrid() {
        if (!this._zoneManager || !this._windowTracker || !this._multiMonitor) return;

        const currentWin = global.display.get_focus_window();
        const monitorIndex = currentWin?.get_monitor()
            ?? global.display.get_current_monitor();
        const wsIndex = global.workspace_manager.get_active_workspace_index();

        // Get active preset for this monitor (default to "halves")
        const presetId = this._multiMonitor.getActivePreset(monitorIndex) ?? "halves";
        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex, this._settings.windowGapSize);
        if (!rects || rects.length === 0) return;

        // Gather unsnapped + snapped-but-different-preset windows
        const candidates = this._windowTracker.getUnsnappedWindows(monitorIndex, wsIndex);

        // Also include already-snapped windows to redistribute
        for (const [windowId, entry] of this._windowTracker._snapped) {
            if (entry.monitorIndex === monitorIndex && entry.workspaceIndex === wsIndex) {
                const win = this._windowTracker._findWindowById(windowId);
                if (win && !candidates.includes(win)) candidates.push(win);
            }
        }

        if (candidates.length === 0) return;

        // Sort by current position: left-to-right, top-to-bottom
        candidates.sort((a, b) => {
            const ar = a.get_frame_rect();
            const br = b.get_frame_rect();
            if (ar.x !== br.x) return ar.x - br.x;
            return ar.y - br.y;
        });

        // Assign windows to zones round-robin
        for (let i = 0; i < candidates.length && i < rects.length; i++) {
            this._windowTracker.snapWindow(candidates[i], presetId, i, rects[i]);
        }
    }
}
