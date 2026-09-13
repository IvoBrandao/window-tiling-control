/**
 * WindowTilingControl — prefs.js
 * Extension preferences UI — Adw-based, 5 pages.
 *
 * Pages:
 *   1. General      — master switch + window gap + drag threshold + log level
 *   2. Features     — toggle cards for each feature
 *   3. Appearance   — snap-assist timeout, animation speed, highlight colors
 *   4. Keybindings  — one row per keybinding with ShortcutLabel capture,
 *                     grouped by tiling / quarters / move-swap / focus /
 *                     modes / monitor / layout / advanced (unbound) shortcuts
 *   5. Layouts      — custom zone sets CRUD + zone editor grid density
 */

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const UUID = "window-tiling-control@gnome-tiling";
const SCHEMA_ID = "org.gnome.shell.extensions.window-tiling-control";
const KB_SCHEMA_ID = "org.gnome.shell.extensions.window-tiling-control.keybindings";

// ── Keybinding groups for Keybindings page (i3-inspired layout) ──────────────
//
// NOTE: every key listed here must have a matching <key> entry in the
// .keybindings child schema AND a registration in src/keybindings.js.
// KB_GROUPS should cover every registered keybinding so users always have a
// way to see/rebind it from the preferences window — including the
// "unbound by default" advanced zone shortcuts.
const KB_GROUPS = [
    {
        title: _("Window Tiling"),
        description: _("Super + arrow key snaps the focused window. Quarter-tiled windows navigate between quarters first."),
        rows: [
            { key: "snap-left-half",     label: _("Tile Left / Navigate Left"),  desc: _("Snap to left half, or move quarter leftward") },
            { key: "snap-right-half",    label: _("Tile Right / Navigate Right"), desc: _("Snap to right half, or move quarter rightward") },
            { key: "snap-upper-quarter", label: _("Tile Up / Navigate Up"),       desc: _("Snap to upper quarter, or move quarter upward") },
            { key: "snap-lower-quarter", label: _("Tile Down / Navigate Down"),   desc: _("Snap to lower quarter, or move quarter downward") },
        ],
    },
    {
        title: _("Direct Quarter Tiling"),
        description: _("Super + U/I/J/K for instant quarter placement (spatial layout on keyboard)."),
        rows: [
            { key: "snap-top-left",      label: _("Quarter: Top-Left (U)"),     desc: _("Snap directly to top-left quarter") },
            { key: "snap-top-right",     label: _("Quarter: Top-Right (I)"),    desc: _("Snap directly to top-right quarter") },
            { key: "snap-bottom-left",   label: _("Quarter: Bottom-Left (J)"),  desc: _("Snap directly to bottom-left quarter") },
            { key: "snap-bottom-right",  label: _("Quarter: Bottom-Right (K)"), desc: _("Snap directly to bottom-right quarter") },
        ],
    },
    {
        title: _("Move / Swap Window"),
        description: _("Super+Shift + arrow key moves a window to the adjacent zone. Swaps with the occupant if that zone is taken."),
        rows: [
            { key: "move-swap-left",  label: _("Move/Swap Left"),  desc: _("Move window one zone left, swap if occupied") },
            { key: "move-swap-right", label: _("Move/Swap Right"), desc: _("Move window one zone right, swap if occupied") },
            { key: "move-swap-up",    label: _("Move/Swap Up"),    desc: _("Move window one zone up, swap if occupied") },
            { key: "move-swap-down",  label: _("Move/Swap Down"),  desc: _("Move window one zone down, swap if occupied") },
        ],
    },
    {
        title: _("Directional Focus (i3-style)"),
        description: _("Super+Alt + arrow key moves keyboard focus to the nearest window in that direction, without moving anything."),
        rows: [
            { key: "focus-left",  label: _("Focus Left"),  desc: _("Focus the nearest window to the left") },
            { key: "focus-right", label: _("Focus Right"), desc: _("Focus the nearest window to the right") },
            { key: "focus-up",    label: _("Focus Up"),    desc: _("Focus the nearest window above") },
            { key: "focus-down",  label: _("Focus Down"),  desc: _("Focus the nearest window below") },
        ],
    },
    {
        title: _("Focus & Auto-Tile"),
        description: _("Cycle focus between tiled windows or auto-tile all visible windows into the active grid layout."),
        rows: [
            { key: "focus-cycle-tiled", label: _("Cycle Focus (Tiled Windows)"), desc: _("Move focus to the next snapped window") },
            { key: "auto-tile-grid",    label: _("Auto-Tile to Active Grid"),    desc: _("Tile all visible windows into the active layout") },
        ],
    },
    {
        title: _("Modes & Help"),
        description: _("Enter keyboard resize mode, or hold to reveal a shortcut cheat sheet."),
        rows: [
            { key: "toggle-resize-mode", label: _("Keyboard Resize Mode"),    desc: _("Arrow keys resize the focused window; Escape/Enter to exit") },
            { key: "show-shortcuts",     label: _("Show Keyboard Shortcuts"), desc: _("Hold to show the cheat sheet; release to dismiss") },
        ],
    },
    {
        title: _("Monitor Movement"),
        description: _("Super+Ctrl + arrow key moves the focused window to an adjacent monitor."),
        rows: [
            { key: "move-monitor-left",  label: _("Move to Left Monitor"),  desc: _("Move window to the monitor on the left") },
            { key: "move-monitor-right", label: _("Move to Right Monitor"), desc: _("Move window to the monitor on the right") },
        ],
    },
    {
        title: _("Layout & Overlay"),
        description: _("Shortcuts for layout management and the snap overlay."),
        rows: [
            { key: "open-snap-overlay",  label: _("Open Snap Layout Picker"), desc: _("Show the Super+Z layout chooser popup") },
            { key: "open-zone-editor",   label: _("Open Zone Editor"),        desc: _("Full-screen drag-to-draw zone editor") },
            { key: "cycle-preset-next",  label: _("Cycle Preset →"),          desc: _("Switch to the next layout preset") },
            { key: "cycle-preset-prev",  label: _("← Cycle Preset"),          desc: _("Switch to the previous layout preset") },
            { key: "restore-snap-group", label: _("Restore Snap Group"),      desc: _("Reposition windows to their last snap group") },
        ],
    },
    {
        title: _("Advanced: Direct Zone Snap"),
        description: _("Unbound by default. Assign a shortcut to snap the focused window straight into a specific zone of the active layout."),
        rows: [1, 2, 3, 4, 5, 6].map(n => ({
            key: `snap-to-zone-${n}`,
            label: _("Snap to Zone %d").replace("%d", String(n)),
            desc: _("Snap the focused window directly into zone %d of the active layout").replace("%d", String(n)),
        })),
    },
];

/** Flat lookup of keybinding key → human label, used for conflict warnings. */
const KB_LABEL_BY_KEY = Object.fromEntries(
    KB_GROUPS.flatMap(group => group.rows.map(row => [row.key, row.label]))
);

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
            title: _("General"),
            icon_name: "preferences-system-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: _("General Settings") });
        page.add(group);

        // Master enable
        group.add(this._switchRow(
            settings, "tiling-enabled",
            _("Enable Window Tiling"),
            _("Master switch for all window tiling features")
        ));

        // Inner gap (between tiled windows)
        group.add(this._spinRow(
            settings, "window-gap-size",
            _("Inner Gap (px)"),
            _("Gap between adjacent tiled windows"),
            0, 40, 1
        ));

        // Outer gap (screen-edge)
        group.add(this._spinRow(
            settings, "outer-gap-size",
            _("Outer Gap (px)"),
            _("Gap between tiled windows and the screen edges (0 = follow inner gap)"),
            0, 80, 1
        ));

        // Drag edge threshold. NB: the schema declares <range min="5" max="100"/>
        // (org.gnome.shell.extensions.window-tiling-control#drag-edge-threshold) —
        // the spin button's lower bound must match or GSettings will refuse/clamp
        // values below 5 that the widget otherwise lets the user select.
        group.add(this._spinRow(
            settings, "drag-edge-threshold",
            _("Drag Edge Threshold (px)"),
            _("Distance from monitor edge that triggers zone detection"),
            5, 100, 1
        ));

        // Log level
        const logGroup = new Adw.PreferencesGroup({ title: _("Diagnostics") });
        page.add(logGroup);
        logGroup.add(this._comboRow(
            settings, "log-level",
            _("Log Level"),
            _("Verbosity of debug output in journalctl"),
            [_("Off"), _("Error"), _("Warning"), _("Info"), _("Debug")]
        ));

        return page;
    }

    // ── Page 2 — Features ────────────────────────────────────────────────────

    _buildFeaturesPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _("Features"),
            icon_name: "view-grid-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: _("Feature Toggles") });
        page.add(group);

        const rows = [
            ["snap-overlay-enabled",       _("Snap Layout Picker"),        _("Super+Z overlay for choosing a layout")],
            ["snap-assist-enabled",        _("Snap Assist"),               _("Show window thumbnails for remaining zones after snapping")],
            ["drag-zone-highlight-enabled",_("Zone Highlights on Drag"),   _("Highlight zones while dragging a window")],
            ["snap-groups-enabled",        _("Snap Groups in Panel"),      _("Show snap group button in the top panel")],
            ["persist-snap-groups",        _("Remember Apps Across Relaunch"), _("Re-snap an app to its last zone when it reopens (if free)")],
        ];

        for (const [key, title, subtitle] of rows)
            group.add(this._switchRow(settings, key, title, subtitle));

        return page;
    }

    // ── Page 3 — Appearance ──────────────────────────────────────────────────

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: _("Appearance"),
            icon_name: "applications-graphics-symbolic",
        });

        const timingGroup = new Adw.PreferencesGroup({ title: _("Timing") });
        page.add(timingGroup);

        // NB: the schema declares <range min="2" max="30"/> for
        // snap-assist-timeout — keep this lower bound in sync (it used to
        // allow 1, below the schema's declared minimum).
        timingGroup.add(this._spinRow(
            settings, "snap-assist-timeout",
            _("Snap Assist Timeout (s)"),
            _("Seconds before Snap Assist auto-dismisses"),
            2, 30, 1
        ));

        timingGroup.add(this._switchRow(
            settings, "animations-enabled",
            _("Enable Animations"),
            _("Master switch — turn off for instant, animation-free snapping")
        ));

        timingGroup.add(this._comboRow(
            settings, "animation-speed",
            _("Animation Speed"),
            _("Speed of snap and overlay animations (ignored when animations are disabled)"),
            [_("Off"), _("Fast"), _("Normal"), _("Slow")]
        ));

        const colorGroup = new Adw.PreferencesGroup({
            title: _("Zone Colors"),
            description: _("Custom colors apply only when the system accent color is turned off."),
        });
        page.add(colorGroup);

        colorGroup.add(this._switchRow(
            settings, "use-accent-color",
            _("Use System Accent Color"),
            _("Tint zone highlights with the GNOME accent color (GNOME 47+)")
        ));

        colorGroup.add(this._colorRow(
            settings, "zone-highlight-color",
            _("Highlight Fill Color"),
            _("RGBA fill color of hovered zone highlight")
        ));

        colorGroup.add(this._colorRow(
            settings, "zone-border-color",
            _("Highlight Border Color"),
            _("RGBA border color of hovered zone highlight")
        ));

        const cornersGroup = new Adw.PreferencesGroup({ title: _("Window Corners") });
        page.add(cornersGroup);

        cornersGroup.add(this._switchRow(
            settings, "rounded-corners-enabled",
            _("Rounded Window Corners"),
            _("Clip normal windows to rounded corners (skips maximized/fullscreen)")
        ));

        cornersGroup.add(this._spinRow(
            settings, "rounded-corners-radius",
            _("Corner Radius (px)"),
            _("Radius of the rounded window corners"),
            0, 40, 1
        ));

        return page;
    }

    // ── Page 4 — Keybindings ─────────────────────────────────────────────────

    _buildKeybindingsPage(kbSettings) {
        const page = new Adw.PreferencesPage({
            title: _("Keybindings"),
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
            title: _("Reset All Keybindings"),
            subtitle: _("Restore all shortcuts to their i3-inspired defaults"),
        });
        const resetBtn = new Gtk.Button({
            label: _("Reset"),
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
            title: _("Layouts"),
            icon_name: "view-paged-symbolic",
        });

        const group = new Adw.PreferencesGroup({
            title: _("Custom Zone Layouts"),
            description: _("Saved zone sets you can use as snap targets"),
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
            tooltip_text: _("Add new zone layout"),
        });
        addBtn.connect("clicked", () => this._addLayoutPlaceholder());
        group.set_header_suffix(addBtn);

        // Zone editor snap-to-grid density. These map to zone-editor-grid-columns
        // / zone-editor-grid-rows, which previously had no preferences UI at all
        // even though they are user-facing (read by src/zoneEditor.js when
        // drawing the snap-to-grid overlay).
        const gridGroup = new Adw.PreferencesGroup({
            title: _("Zone Editor Grid"),
            description: _("Density of the snap-to-grid guide shown while drawing zones in the full-screen Zone Editor (Super+E)."),
        });
        page.add(gridGroup);

        gridGroup.add(this._spinRow(
            settings, "zone-editor-grid-columns",
            _("Grid Columns"),
            _("Number of column divisions in the zone editor snap grid"),
            4, 24, 1
        ));

        gridGroup.add(this._spinRow(
            settings, "zone-editor-grid-rows",
            _("Grid Rows"),
            _("Number of row divisions in the zone editor snap grid"),
            4, 16, 1
        ));

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
                title: set.label ?? _("Unnamed"),
                subtitle: `${(set.zones ?? []).length} ${_("zones")}`,
            });

            const deleteBtn = new Gtk.Button({
                icon_name: "user-trash-symbolic",
                valign: Gtk.Align.CENTER,
                css_classes: ["flat", "destructive-action"],
                tooltip_text: _("Delete this layout"),
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
            title: _("Open the Zone Editor"),
            subtitle: _("Use Super+E or the Quick Settings button to draw zones"),
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
        } catch (_e) {
            // Fallback for GNOME 45. NB: this catch parameter must not be
            // named "_" — that would shadow the imported gettext `_()`
            // function for the rest of this block.
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
            disabled_text: _("Disabled"),
        });

        const currentBindings = kbSettings.get_strv(key);
        shortcutLabel.set_accelerator(currentBindings[0] ?? "");

        // Single "Set Shortcut" button — opens a dialog where user types the
        // GTK accelerator string.  This always works, even for Super-based
        // combos that the compositor would otherwise grab.
        const setBtn = new Gtk.Button({
            label: _("Set Shortcut"),
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: _("Type a shortcut string (e.g. <Super>Left)"),
        });
        setBtn.connect("clicked", () => this._typeShortcut(row, kbSettings, key, shortcutLabel));

        const clearBtn = new Gtk.Button({
            icon_name: "edit-clear-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: _("Clear shortcut"),
        });
        clearBtn.connect("clicked", () => {
            kbSettings.set_strv(key, []);
            shortcutLabel.set_accelerator("");
        });

        // Keep the label in sync if this key changes from elsewhere — e.g.
        // the "Reset All" button, or another row's dialog "stealing" this
        // accelerator away via the conflict-reassignment flow below.
        const changedId = kbSettings.connect(`changed::${key}`, () => {
            shortcutLabel.set_accelerator(kbSettings.get_strv(key)[0] ?? "");
        });
        row.connect("destroy", () => kbSettings.disconnect(changedId));

        row.add_suffix(shortcutLabel);
        row.add_suffix(setBtn);
        row.add_suffix(clearBtn);
        return row;
    }

    /**
     * Find another keybinding (besides `excludeKey`) that is already bound to
     * `accel`, so callers can warn before silently creating a conflicting
     * shortcut (two actions grabbing the same accelerator otherwise fail
     * silently — Mutter honours whichever one was registered first).
     * @returns {string|null} the conflicting key name, or null if none.
     */
    _findKeybindingConflict(kbSettings, accel, excludeKey) {
        const keys = kbSettings.settings_schema?.list_keys() ?? [];
        for (const otherKey of keys) {
            if (otherKey === excludeKey) continue;
            if (kbSettings.get_strv(otherKey).includes(accel))
                return otherKey;
        }
        return null;
    }

    /**
     * Shortcut entry: user types the GTK accelerator string
     * (e.g. "<Super>Left", "<Primary><Shift>a").
     * This bypasses compositor key grabs entirely.
     */
    _typeShortcut(parentRow, kbSettings, key, shortcutLabel) {
        const dialog = new Gtk.Dialog({
            title: _("Type shortcut for: %s").replace("%s", parentRow.title),
            modal: true,
            resizable: false,
        });

        let topLevel = parentRow.get_root?.();
        if (topLevel instanceof Gtk.Window)
            dialog.set_transient_for(topLevel);

        const content = dialog.get_content_area();

        const hintLabel = new Gtk.Label({
            label: _("Type the shortcut string using GTK format:") + "\n" +
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
            wrap: true,
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

        const cancelBtn = new Gtk.Button({ label: _("Cancel") });
        cancelBtn.connect("clicked", () => dialog.close());
        btnBox.append(cancelBtn);

        const applyBtn = new Gtk.Button({
            label: _("Apply"),
            css_classes: ["suggested-action"],
        });

        // A conflict warning requires a second click to confirm reassignment
        // (it "steals" the accelerator from the other action). Any edit to
        // the entry clears the pending confirmation so a stale click can't
        // silently reassign a *different*, unreviewed shortcut.
        let pendingConflictKey = null;
        entry.connect("changed", () => {
            pendingConflictKey = null;
            applyBtn.set_label(_("Apply"));
        });

        applyBtn.connect("clicked", () => {
            const text = entry.get_text().trim();
            if (!text) {
                statusLabel.set_text(_("Enter a shortcut string."));
                return;
            }

            // Validate the accelerator string
            const [valid, parsedKey, parsedMods] = Gtk.accelerator_parse(text);
            if (!valid || parsedKey === 0) {
                statusLabel.set_text(_("\"%s\" is not a valid GTK shortcut.").replace("%s", text));
                return;
            }

            // Normalise to canonical form
            const canonical = Gtk.accelerator_name(parsedKey, parsedMods);

            const conflictKey = this._findKeybindingConflict(kbSettings, canonical, key);
            if (conflictKey && pendingConflictKey !== conflictKey) {
                const conflictLabel = KB_LABEL_BY_KEY[conflictKey] ?? conflictKey;
                statusLabel.set_text(
                    _("Already used by \"%s\". Click Apply again to move it here.").replace("%s", conflictLabel)
                );
                pendingConflictKey = conflictKey;
                applyBtn.set_label(_("Apply Anyway"));
                return;
            }

            if (conflictKey)
                kbSettings.set_strv(conflictKey, []);

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
