/**
 * WindowTilingControl — src/shortcutsCheatsheet.js
 * A hold-to-show keyboard cheat sheet. Triggered by a keybinding; it lists every
 * configured shortcut (read live from GSettings) grouped by category, and closes
 * as soon as the user releases the key (or presses Escape / clicks away).
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

const KEY_ESCAPE = 0xFF1B;

/**
 * Group definitions: which keybinding keys belong under which heading, in order.
 * Keys not listed here fall under "Other".
 */
const GROUPS = [
    { title: "Tiling", keys: ["snap-left-half", "snap-right-half", "snap-upper-quarter", "snap-lower-quarter", "snap-top-left", "snap-top-right", "snap-bottom-left", "snap-bottom-right"] },
    { title: "Move & Swap", keys: ["move-swap-left", "move-swap-right", "move-swap-up", "move-swap-down"] },
    { title: "Focus", keys: ["focus-left", "focus-right", "focus-up", "focus-down", "focus-cycle-tiled"] },
    { title: "Layouts", keys: ["open-snap-overlay", "open-zone-editor", "cycle-preset-next", "cycle-preset-prev", "auto-tile-grid", "restore-snap-group"] },
    { title: "Monitors", keys: ["move-monitor-left", "move-monitor-right"] },
    { title: "Help", keys: ["show-shortcuts"] },
];

export class ShortcutsCheatsheet {
    constructor(settings, logger) {
        this._settings = settings;
        this._log = logger;
        this._widget = null;
        this._captureId = null;
    }

    isOpen() {
        return !!this._widget;
    }

    /** Show the cheat sheet. Closes on key release / Escape / outside click. */
    open() {
        if (this._widget) return;

        this._widget = new St.BoxLayout({
            style_class: "wtc-cheatsheet",
            vertical: true,
            reactive: true,
        });

        const title = new St.Label({
            text: _("Keyboard Shortcuts"),
            style_class: "wtc-cheatsheet-title",
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._widget.add_child(title);

        const columns = new St.BoxLayout({ style_class: "wtc-cheatsheet-columns", vertical: false });
        this._widget.add_child(columns);

        // Build up to 2 columns of groups for a compact layout.
        let col = this._newColumn();
        columns.add_child(col);
        let rowsInCol = 0;
        for (const group of GROUPS) {
            const rows = this._buildGroup(group);
            if (!rows) continue;
            if (rowsInCol >= 3 && columns.get_children().length < 2) {
                col = this._newColumn();
                columns.add_child(col);
                rowsInCol = 0;
            }
            col.add_child(rows);
            rowsInCol++;
        }

        const hint = new St.Label({
            text: _("Release the key to dismiss"),
            style_class: "wtc-cheatsheet-hint",
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._widget.add_child(hint);

        Main.uiGroup.add_child(this._widget);
        this._center();

        // Hold-to-show: close on the next key RELEASE, on Escape, or on a click.
        this._captureId = global.stage.connect("captured-event", (_a, event) => {
            const t = event.type();
            if (t === Clutter.EventType.KEY_RELEASE) { this.close(); return Clutter.EVENT_PROPAGATE; }
            if (t === Clutter.EventType.BUTTON_PRESS) { this.close(); return Clutter.EVENT_PROPAGATE; }
            if (t === Clutter.EventType.KEY_PRESS && event.get_key_symbol?.() === KEY_ESCAPE) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    close() {
        if (!this._widget) return;
        if (this._captureId) {
            try { global.stage.disconnect(this._captureId); } catch (_) {}
            this._captureId = null;
        }
        const w = this._widget;
        this._widget = null;
        try {
            Main.uiGroup.remove_child(w);
            w.destroy();
        } catch (_) {}
    }

    toggle() {
        if (this._widget) this.close();
        else this.open();
    }

    destroy() {
        this.close();
    }

    // ------------------------------------------------------------------ private

    _newColumn() {
        return new St.BoxLayout({ style_class: "wtc-cheatsheet-column", vertical: true });
    }

    _buildGroup(group) {
        const rows = [];
        for (const key of group.keys) {
            const accel = this._accelFor(key);
            if (!accel) continue; // unbound → skip
            rows.push({ key, accel });
        }
        if (!rows.length) return null;

        const box = new St.BoxLayout({ style_class: "wtc-cheatsheet-group", vertical: true });
        box.add_child(new St.Label({
            text: _(group.title),
            style_class: "wtc-cheatsheet-group-title",
        }));

        for (const { key, accel } of rows) {
            const row = new St.BoxLayout({ style_class: "wtc-cheatsheet-row", vertical: false });
            const label = new St.Label({
                text: this._summaryFor(key),
                style_class: "wtc-cheatsheet-label",
                x_expand: true,
            });
            const keys = new St.Label({
                text: accel,
                style_class: "wtc-cheatsheet-keys",
            });
            row.add_child(label);
            row.add_child(keys);
            box.add_child(row);
        }
        return box;
    }

    /** Human summary for a keybinding key, from the schema. */
    _summaryFor(key) {
        try {
            return this._settings.kbSettings.settings_schema.get_key(key).get_summary() || key;
        } catch (_) {
            return key;
        }
    }

    /** Prettified accelerator string for a keybinding key (first binding), or "". */
    _accelFor(key) {
        let arr;
        try { arr = this._settings.getKeybinding(key); } catch (_) { return ""; }
        if (!arr || !arr.length || !arr[0]) return "";
        return prettifyAccel(arr[0]);
    }

    _center() {
        if (!this._widget) return;
        this._widget.ensure_style();
        const mon = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        const geom = global.display.get_monitor_geometry(mon);
        const w = this._widget.width || 640;
        const h = this._widget.height || 400;
        this._widget.set_position(
            Math.round(geom.x + (geom.width - w) / 2),
            Math.round(geom.y + (geom.height - h) / 2)
        );
    }
}

/** Turn a GTK accelerator ("<Super><Shift>Left") into a readable "Super + Shift + ←". */
export function prettifyAccel(accel) {
    let s = accel
        .replace(/<Super>/g, "Super+")
        .replace(/<Primary>/g, "Ctrl+")
        .replace(/<Control>/g, "Ctrl+")
        .replace(/<Ctrl>/g, "Ctrl+")
        .replace(/<Shift>/g, "Shift+")
        .replace(/<Alt>/g, "Alt+");

    const map = {
        Left: "←", Right: "→", Up: "↑", Down: "↓",
        bracketright: "]", bracketleft: "[",
        slash: "/", question: "?", semicolon: ";",
        Return: "Enter", KP_Enter: "Enter", space: "Space", Tab: "Tab",
    };
    // Replace the trailing key token.
    const parts = s.split("+");
    let last = parts.pop();
    last = map[last] ?? (last.length === 1 ? last.toUpperCase() : last);
    parts.push(last);
    return parts.join(" + ");
}
