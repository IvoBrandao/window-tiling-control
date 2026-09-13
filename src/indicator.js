/**
 * WindowTilingControl — src/indicator.js
 * Quick Settings SystemIndicator + QuickMenuToggle for GNOME 43+.
 *
 * Adds a "WindowTilingControl" entry to the Quick Settings panel with:
 *   - Enable/disable master toggle
 *   - Sub-switches for Snap Overlay, Snap Assist, Zone Highlights, Snap
 *     Groups, and Rounded Corners
 *   - "Edit Zones…" action row that opens the Zone Editor
 *   - "Preferences…" action row that opens the extension preferences
 */

import St from "gi://St";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import {
    PopupMenuItem,
    PopupSeparatorMenuItem,
    PopupSwitchMenuItem,
} from "resource:///org/gnome/shell/ui/popupMenu.js";
import { _ } from "./i18n.js";

// ── Toggle (main button in Quick Settings grid) ──────────────────────────────

const WindowTilingControlToggle = GObject.registerClass(
    class WindowTilingControlToggle extends QuickSettings.QuickMenuToggle {
        _init(settings, controller) {
            super._init({
                title: "Window Tiling Control",
                iconName: "view-grid-symbolic",
                toggleMode: true,
            });

            this._settings = settings;
            this._controller = controller;

            // Bind master enable setting
            settings.raw.bind(
                "tiling-enabled",
                this,
                "checked",
                Gio.SettingsBindFlags.DEFAULT
            );

            // Build submenu
            this._buildMenu();
        }

        _buildMenu() {
            this.menu.setHeader("view-grid-symbolic", "Window Tiling Control");

            // Feature toggles
            const toggles = [
                { key: "snap-overlay-enabled",      label: _("Snap Layout Picker") },
                { key: "snap-assist-enabled",        label: _("Snap Assist") },
                { key: "drag-zone-highlight-enabled",label: _("Zone Highlights on Drag") },
                { key: "snap-groups-enabled",        label: _("Snap Groups in Panel") },
                { key: "rounded-corners-enabled",    label: _("Rounded Window Corners") },
            ];

            for (const { key, label } of toggles) {
                const item = new PopupSwitchMenuItem(label, false);
                this._settings.raw.bind(
                    key,
                    item,
                    "state",
                    Gio.SettingsBindFlags.DEFAULT
                );
                this.menu.addMenuItem(item);
            }

            this.menu.addMenuItem(new PopupSeparatorMenuItem());

            // Edit Zones action
            const editItem = new PopupMenuItem(_("Edit Zones…"));
            editItem.connect("activate", () => {
                this.menu.close();
                this._controller?.openZoneEditor();
            });
            this.menu.addMenuItem(editItem);

            // Open Preferences action
            const prefsItem = new PopupMenuItem(_("Preferences…"));
            prefsItem.connect("activate", () => {
                this.menu.close();
                try {
                    Main.extensionManager.openExtensionPrefs(
                        "window-tiling-control@gnome-tiling",
                        "",
                        {}
                    );
                } catch (_e) { /* no-op if not available */ }
            });
            this.menu.addMenuItem(prefsItem);
        }
    }
);

// ── SystemIndicator wrapper ───────────────────────────────────────────────────

const WindowTilingControlIndicator = GObject.registerClass(
    class WindowTilingControlIndicator extends QuickSettings.SystemIndicator {
        _init(settings, controller) {
            super._init();

            this._indicator = this._addIndicator();
            this._indicator.iconName = "view-grid-symbolic";

            // Only show indicator dot when WindowTilingControl is enabled
            settings.raw.bind(
                "tiling-enabled",
                this._indicator,
                "visible",
                Gio.SettingsBindFlags.GET
            );

            this._toggle = new WindowTilingControlToggle(settings, controller);
            this.quickSettingsItems.push(this._toggle);
        }

        destroy() {
            try {
                this._toggle?.destroy();
            } catch (_e) { /* already disposed */ }
            this._toggle = null;
            super.destroy();
        }
    }
);

// ── Public Indicator class ────────────────────────────────────────────────────

export class Indicator {
    constructor(settings, controller, logger) {
        this._settings = settings;
        this._controller = controller;
        this._log = logger;
        this._indicator = null;
    }

    enable() {
        this._indicator = new WindowTilingControlIndicator(this._settings, this._controller);

        Main.panel.statusArea.quickSettings.addExternalIndicator(
            this._indicator
        );

        this._log?.info("Indicator: enabled");
    }

    disable() {
        if (this._indicator) {
            // Destroy toggle items first, then the indicator itself.
            // Guard against already-disposed widgets (GNOME may auto-destroy
            // QuickSettings items when the panel is rebuilt or on lock screen).
            try {
                this._indicator.quickSettingsItems.forEach(i => i.destroy());
            } catch (_e) { /* already disposed */ }
            try {
                this._indicator.destroy();
            } catch (_e) { /* already disposed */ }
            this._indicator = null;
        }
        this._log?.info("Indicator: disabled");
    }

    show() { this._indicator?.show(); }
    hide() { this._indicator?.hide(); }
}
