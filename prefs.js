/**
 * WindowTilingControl — prefs.js
 * Extension preferences UI — Adw-based, 5 pages.
 *
 * Pages:
 *   1. General      — master switch + window gap + drag threshold + log level
 *   2. Features     — toggle cards for each feature
 *   3. Appearance   — snap-assist timeout, animation speed, highlight colors
 *   4. Keybindings  — one row per keybinding with ShortcutLabel capture
 *   5. Layouts      — custom zone sets CRUD
 */

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const UUID = "window-tiling-control@gnome-tiling";
const SCHEMA_ID = "org.gnome.shell.extensions.window-tiling-control";
const KB_SCHEMA_ID = "org.gnome.shell.extensions.window-tiling-control.keybindings";

// ── Keybinding groups for Keybindings page (i3-inspired layout) ──────────────
const KB_GROUPS = [
    {
        title: "Window Tiling",
        description: "Super + arrow key snaps the focused window. Quarter-tiled windows navigate between quarters first.",
        rows: [
            { key: "snap-left-half",     label: "Tile Left / Navigate Left",  desc: "Snap to left half, or move quarter leftward" },
            { key: "snap-right-half",    label: "Tile Right / Navigate Right", desc: "Snap to right half, or move quarter rightward" },
            { key: "snap-upper-quarter", label: "Tile Up / Navigate Up",       desc: "Snap to upper quarter, or move quarter upward" },
            { key: "snap-lower-quarter", label: "Tile Down / Navigate Down",   desc: "Snap to lower quarter, or move quarter downward" },
        ],
    },
    {
        title: "Direct Quarter Tiling",
        description: "Super + U/I/J/K for instant quarter placement (spatial layout on keyboard).",
        rows: [
            { key: "snap-top-left",      label: "Quarter: Top-Left (U)",     desc: "Snap directly to top-left quarter" },
            { key: "snap-top-right",     label: "Quarter: Top-Right (I)",    desc: "Snap directly to top-right quarter" },
            { key: "snap-bottom-left",   label: "Quarter: Bottom-Left (J)",  desc: "Snap directly to bottom-left quarter" },
            { key: "snap-bottom-right",  label: "Quarter: Bottom-Right (K)", desc: "Snap directly to bottom-right quarter" },
        ],
    },
    {
        title: "Move / Swap Window",
        description: "Super+Shift + arrow key moves a window to the adjacent zone. Swaps with the occupant if that zone is taken.",
        rows: [
            { key: "move-swap-left",  label: "Move/Swap Left",  desc: "Move window one zone left, swap if occupied" },
            { key: "move-swap-right", label: "Move/Swap Right", desc: "Move window one zone right, swap if occupied" },
            { key: "move-swap-up",    label: "Move/Swap Up",    desc: "Move window one zone up, swap if occupied" },
            { key: "move-swap-down",  label: "Move/Swap Down",  desc: "Move window one zone down, swap if occupied" },
        ],
    },
    {
        title: "Focus & Auto-Tile",
        description: "Cycle focus between tiled windows or auto-tile all visible windows into the active grid layout.",
        rows: [
            { key: "focus-cycle-tiled", label: "Cycle Focus (Tiled Windows)", desc: "Move focus to the next snapped window" },
            { key: "auto-tile-grid",    label: "Auto-Tile to Active Grid",    desc: "Tile all visible windows into the active layout" },
        ],
    },
    {
        title: "Monitor Movement",
        description: "Super+Ctrl + arrow key moves the focused window to an adjacent monitor.",
        rows: [
            { key: "move-monitor-left",  label: "Move to Left Monitor",  desc: "Move window to the monitor on the left" },
            { key: "move-monitor-right", label: "Move to Right Monitor", desc: "Move window to the monitor on the right" },
        ],
    },
    {
        title: "Layout & Overlay",
        description: "Shortcuts for layout management and the snap overlay.",
        rows: [
            { key: "open-snap-overlay",  label: "Open Snap Layout Picker", desc: "Show the Super+Z layout chooser popup" },
            { key: "open-zone-editor",   label: "Open Zone Editor",        desc: "Full-screen drag-to-draw zone editor" },
            { key: "cycle-preset-next",  label: "Cycle Preset →",          desc: "Switch to the next layout preset" },
            { key: "cycle-preset-prev",  label: "← Cycle Preset",          desc: "Switch to the previous layout preset" },
            { key: "restore-snap-group", label: "Restore Snap Group",      desc: "Reposition windows to their last snap group" },
        ],
    },
];

export default class WindowTilingControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);
        const kbSettings = this.getSettings(KB_SCHEMA_ID);

        window.set_default_size(720, 640);
        window.add(this._buildGeneralPage(settings));
        window.add(this._buildFeaturesPage(settings));
        window.add(this._buildAppearancePage(settings));
        window.add(this._buildKeybindingsPage(kbSettings));
        window.add(this._buildLayoutsPage(settings));
    }

    // ── Page 1 — General ─────────────────────────────────────────────────────

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "General",
            icon_name: "preferences-system-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: "General Settings" });
        page.add(group);

        // Master enable
        group.add(this._switchRow(
            settings, "tiling-enabled",
            "Enable Window Tiling",
            "Master switch for all window tiling features"
        ));

        // Inner gap (between tiled windows)
        group.add(this._spinRow(
            settings, "window-gap-size",
            "Inner Gap (px)",
            "Gap between adjacent tiled windows",
            0, 40, 1
        ));

        // Outer gap (screen-edge)
        group.add(this._spinRow(
            settings, "outer-gap-size",
            "Outer Gap (px)",
            "Gap between tiled windows and the screen edges (0 = follow inner gap)",
            0, 80, 1
        ));

        // Drag edge threshold
        group.add(this._spinRow(
            settings, "drag-edge-threshold",
            "Drag Edge Threshold (px)",
            "Distance from monitor edge that triggers zone detection",
            0, 100, 1
        ));

        // Log level
        const logGroup = new Adw.PreferencesGroup({ title: "Diagnostics" });
        page.add(logGroup);
        logGroup.add(this._comboRow(
            settings, "log-level",
            "Log Level",
            "Verbosity of debug output in journalctl",
            ["Off", "Error", "Warning", "Info", "Debug"]
        ));

        return page;
    }

    // ── Page 2 — Features ────────────────────────────────────────────────────

    _buildFeaturesPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Features",
            icon_name: "view-grid-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: "Feature Toggles" });
        page.add(group);

        const rows = [
            ["snap-overlay-enabled",       "Snap Layout Picker",        "Super+Z overlay for choosing a layout"],
            ["snap-assist-enabled",        "Snap Assist",               "Show window thumbnails for remaining zones after snapping"],
            ["drag-zone-highlight-enabled","Zone Highlights on Drag",   "Highlight zones while dragging a window"],
            ["snap-groups-enabled",        "Snap Groups in Panel",      "Show snap group button in the top panel"],
            ["persist-snap-groups",        "Remember Apps Across Relaunch", "Re-snap an app to its last zone when it reopens (if free)"],
        ];

        for (const [key, title, subtitle] of rows)
            group.add(this._switchRow(settings, key, title, subtitle));

        return page;
    }

    // ── Page 3 — Appearance ──────────────────────────────────────────────────

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Appearance",
            icon_name: "applications-graphics-symbolic",
        });

        const timingGroup = new Adw.PreferencesGroup({ title: "Timing" });
        page.add(timingGroup);

        timingGroup.add(this._spinRow(
            settings, "snap-assist-timeout",
            "Snap Assist Timeout (s)",
            "Seconds before Snap Assist auto-dismisses",
            1, 30, 1
        ));

        timingGroup.add(this._switchRow(
            settings, "animations-enabled",
            "Enable Animations",
            "Master switch — turn off for instant, animation-free snapping"
        ));

        timingGroup.add(this._comboRow(
            settings, "animation-speed",
            "Animation Speed",
            "Speed of snap and overlay animations (ignored when animations are disabled)",
            ["Off", "Fast", "Normal", "Slow"]
        ));

        const colorGroup = new Adw.PreferencesGroup({
            title: "Zone Colors",
            description: "Custom colors apply only when the system accent color is turned off.",
        });
        page.add(colorGroup);

        colorGroup.add(this._switchRow(
            settings, "use-accent-color",
            "Use System Accent Color",
            "Tint zone highlights with the GNOME accent color (GNOME 47+)"
        ));

        colorGroup.add(this._colorRow(
            settings, "zone-highlight-color",
            "Highlight Fill Color",
            "RGBA fill color of hovered zone highlight"
        ));

        colorGroup.add(this._colorRow(
            settings, "zone-border-color",
            "Highlight Border Color",
            "RGBA border color of hovered zone highlight"
        ));

        const cornersGroup = new Adw.PreferencesGroup({ title: "Window Corners" });
        page.add(cornersGroup);

        cornersGroup.add(this._switchRow(
            settings, "rounded-corners-enabled",
            "Rounded Window Corners",
            "Clip normal windows to rounded corners (skips maximized/fullscreen)"
        ));

        cornersGroup.add(this._spinRow(
            settings, "rounded-corners-radius",
            "Corner Radius (px)",
            "Radius of the rounded window corners",
            0, 40, 1
        ));

        return page;
    }

    // ── Page 4 — Keybindings ─────────────────────────────────────────────────

    _buildKeybindingsPage(kbSettings) {
        const page = new Adw.PreferencesPage({
            title: "Keybindings",
            icon_name: "input-keyboard-symbolic",
        });

        // Build a group per category
        for (const section of KB_GROUPS) {
            const group = new Adw.PreferencesGroup({
                title: section.title,
                description: section.description,
            });
            page.add(group);

            for (const { key, label, desc } of section.rows)
                group.add(this._keybindingRow(kbSettings, key, label, desc));
        }

        // Reset all keybindings button
        const resetGroup = new Adw.PreferencesGroup();
        page.add(resetGroup);

        const resetRow = new Adw.ActionRow({
            title: "Reset All Keybindings",
            subtitle: "Restore all shortcuts to their i3-inspired defaults",
        });
        const resetBtn = new Gtk.Button({
            label: "Reset",
            valign: Gtk.Align.CENTER,
            css_classes: ["destructive-action"],
        });
        resetBtn.connect("clicked", () => {
            for (const section of KB_GROUPS)
                for (const { key } of section.rows)
                    kbSettings.reset(key);
            // Rebuild the page to refresh all labels
            const window = page.get_root();
            if (window) {
                window.remove(page);
                window.add(this._buildKeybindingsPage(kbSettings));
            }
        });
        resetRow.add_suffix(resetBtn);
        resetRow.set_activatable_widget(resetBtn);
        resetGroup.add(resetRow);

        return page;
    }

    // ── Page 5 — Layouts ─────────────────────────────────────────────────────

    _buildLayoutsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Layouts",
            icon_name: "view-paged-symbolic",
        });

        const group = new Adw.PreferencesGroup({
            title: "Custom Zone Layouts",
            description: "Saved zone sets you can use as snap targets",
        });
        page.add(group);

        this._layoutGroup = group;
        this._layoutSettings = settings;
        this._rebuildLayoutRows();

        // "Add new" button in header suffix
        const addBtn = new Gtk.Button({
            icon_name: "list-add-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Add new zone layout",
        });
        addBtn.connect("clicked", () => this._addLayoutPlaceholder());
        group.set_header_suffix(addBtn);

        return page;
    }

    _rebuildLayoutRows() {
        // Remove existing dynamic rows (all except the add button suffix)
        // Adw.PreferencesGroup has no bulk-remove; workaround: destroy + re-add children
        // For simplicity we store references
        if (this._layoutRows) {
            for (const row of this._layoutRows)
                this._layoutGroup.remove(row);
        }
        this._layoutRows = [];

        const raw = this._layoutSettings.get_strv("custom-zone-sets");
        const sets = raw.map(s => { try { return JSON.parse(s); } catch { return null; } })
                        .filter(Boolean);

        for (const set of sets) {
            const row = new Adw.ActionRow({
                title: set.label ?? "Unnamed",
                subtitle: `${(set.zones ?? []).length} zones`,
            });

            const deleteBtn = new Gtk.Button({
                icon_name: "user-trash-symbolic",
                valign: Gtk.Align.CENTER,
                css_classes: ["flat", "destructive-action"],
                tooltip_text: "Delete this layout",
            });
            deleteBtn.connect("clicked", () => {
                const updated = raw.filter(s => {
                    try { return JSON.parse(s).id !== set.id; } catch { return true; }
                });
                this._layoutSettings.set_strv("custom-zone-sets", updated);
                this._rebuildLayoutRows();
            });
            row.add_suffix(deleteBtn);

            this._layoutGroup.add(row);
            this._layoutRows.push(row);
        }
    }

    _addLayoutPlaceholder() {
        // Add a blank entry that tells the user to use the in-shell editor
        const infoRow = new Adw.ActionRow({
            title: "Open the Zone Editor",
            subtitle: "Use Super+E or the Quick Settings button to draw zones",
        });
        this._layoutGroup.add(infoRow);
        this._layoutRows.push(infoRow);
    }

    // ── Row builders ─────────────────────────────────────────────────────────

    _switchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({ title, subtitle });
        settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
        });
        settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _comboRow(settings, key, title, subtitle, choices) {
        const row = new Adw.ComboRow({ title, subtitle });
        const model = Gtk.StringList.new(choices);
        row.set_model(model);
        row.set_selected(settings.get_uint(key));
        row.connect("notify::selected", () => {
            settings.set_uint(key, row.selected);
        });
        // Update if changed externally
        const handlerId = settings.connect(`changed::${key}`, () => {
            row.set_selected(settings.get_uint(key));
        });
        row.connect("destroy", () => settings.disconnect(handlerId));
        return row;
    }

    _colorRow(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({ title, subtitle });

        let colorWidget;
        try {
            // GNOME 46+: use Gtk.ColorDialogButton
            const dialog = new Gtk.ColorDialog({ title, with_alpha: true });
            colorWidget = new Gtk.ColorDialogButton({ dialog, valign: Gtk.Align.CENTER });
            this._bindColor(settings, key, colorWidget, "rgba", true);
        } catch (_) {
            // Fallback for GNOME 45
            colorWidget = new Gtk.ColorButton({ use_alpha: true, valign: Gtk.Align.CENTER });
            this._bindColor(settings, key, colorWidget, "rgba", false);
        }

        row.add_suffix(colorWidget);
        row.set_activatable_widget(colorWidget);
        return row;
    }

    _bindColor(settings, key, widget, prop, isDialog) {
        const load = () => {
            const str = settings.get_string(key);
            const rgba = new Gdk.RGBA();
            if (rgba.parse(str)) widget[prop] = rgba;
        };
        load();
        widget.connect(`notify::${prop}`, () => {
            settings.set_string(key, widget[prop].to_string());
        });
        const h = settings.connect(`changed::${key}`, load);
        widget.connect("destroy", () => settings.disconnect(h));
    }

    _keybindingRow(kbSettings, key, label, subtitle) {
        const row = new Adw.ActionRow({ title: label, subtitle: subtitle ?? "" });

        const shortcutLabel = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: "Disabled",
        });

        const currentBindings = kbSettings.get_strv(key);
        shortcutLabel.set_accelerator(currentBindings[0] ?? "");

        // Single "Set Shortcut" button — opens a dialog where user types the
        // GTK accelerator string.  This always works, even for Super-based
        // combos that the compositor would otherwise grab.
        const setBtn = new Gtk.Button({
            label: "Set Shortcut",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Type a shortcut string (e.g. <Super>Left)",
        });
        setBtn.connect("clicked", () => this._typeShortcut(row, kbSettings, key, shortcutLabel));

        const clearBtn = new Gtk.Button({
            icon_name: "edit-clear-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Clear shortcut",
        });
        clearBtn.connect("clicked", () => {
            kbSettings.set_strv(key, []);
            shortcutLabel.set_accelerator("");
        });

        row.add_suffix(shortcutLabel);
        row.add_suffix(setBtn);
        row.add_suffix(clearBtn);
        return row;
    }

    /**
     * Shortcut entry: user types the GTK accelerator string
     * (e.g. "<Super>Left", "<Primary><Shift>a").
     * This bypasses compositor key grabs entirely.
     */
    _typeShortcut(parentRow, kbSettings, key, shortcutLabel) {
        const dialog = new Gtk.Dialog({
            title: `Type shortcut for: ${parentRow.title}`,
            modal: true,
            resizable: false,
        });

        let topLevel = parentRow.get_root?.();
        if (topLevel instanceof Gtk.Window)
            dialog.set_transient_for(topLevel);

        const content = dialog.get_content_area();

        const hintLabel = new Gtk.Label({
            label: "Type the shortcut string using GTK format:\n" +
                   "  <Super>Left   <Super>z   <Primary><Alt>t\n" +
                   "  <Super>Home   <Super><Shift>Right",
            margin_top: 16,
            margin_start: 24,
            margin_end: 24,
            wrap: true,
        });
        content.append(hintLabel);

        const entry = new Gtk.Entry({
            placeholder_text: "<Super>Left",
            margin_top: 12,
            margin_bottom: 8,
            margin_start: 24,
            margin_end: 24,
        });

        // Pre-fill with current binding
        const current = kbSettings.get_strv(key);
        if (current.length > 0)
            entry.set_text(current[0]);

        content.append(entry);

        const statusLabel = new Gtk.Label({
            label: "",
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
            css_classes: ["dim-label"],
        });
        content.append(statusLabel);

        const btnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
            halign: Gtk.Align.END,
        });

        const cancelBtn = new Gtk.Button({ label: "Cancel" });
        cancelBtn.connect("clicked", () => dialog.close());
        btnBox.append(cancelBtn);

        const applyBtn = new Gtk.Button({
            label: "Apply",
            css_classes: ["suggested-action"],
        });
        applyBtn.connect("clicked", () => {
            const text = entry.get_text().trim();
            if (!text) {
                statusLabel.set_text("Enter a shortcut string.");
                return;
            }

            // Validate the accelerator string
            const [valid, parsedKey, parsedMods] = Gtk.accelerator_parse(text);
            if (!valid || parsedKey === 0) {
                statusLabel.set_text(`"${text}" is not a valid GTK shortcut.`);
                return;
            }

            // Normalise to canonical form
            const canonical = Gtk.accelerator_name(parsedKey, parsedMods);
            kbSettings.set_strv(key, [canonical]);
            shortcutLabel.set_accelerator(canonical);
            dialog.close();
        });
        btnBox.append(applyBtn);

        // Also accept Enter in the text entry
        entry.connect("activate", () => applyBtn.emit("clicked"));

        content.append(btnBox);
        dialog.present();
        entry.grab_focus();
    }
}
