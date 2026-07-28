/**
 * WindowTilingControl — src/snapGroups.js
 * Tracks snap groups and shows a panel indicator button + popup when
 * groups exist on the active workspace.
 */

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

export class SnapGroupsManager {
    constructor(settings, windowTracker, animations, logger) {
        this._settings = settings;
        this._windowTracker = windowTracker;
        this._animations = animations;
        this._log = logger;

        this._button = null;
        this._popup = null;
        this._popupVisible = false;
        this._displaySignalIds = [];
        this._wmSignalIds = [];
    }

    enable() {
        if (!this._settings.snapGroupsEnabled) return;

        this._buildButton();

        // Refresh panel button when workspace changes or windows snap/unsnap
        this._wmSignalIds.push(
            global.workspace_manager.connect(
                "active-workspace-changed",
                () => this._refreshButton()
            )
        );

        // Recheck groups when any window is added or removed
        this._displaySignalIds.push(
            global.display.connect("window-created", () => this._refreshButton()),
        );
        this._wmSignalIds.push(
            global.workspace_manager.connect("workspace-removed", () => this._refreshButton()),
        );

        this._refreshButton();
    }

    disable() {
        this._closePopup();

        for (const id of this._displaySignalIds)
            try { global.display.disconnect(id); } catch (_) {}
        for (const id of this._wmSignalIds)
            try { global.workspace_manager.disconnect(id); } catch (_) {}
        this._displaySignalIds = [];
        this._wmSignalIds = [];

        this._button?.destroy();
        this._button = null;
    }

    // ------------------------------------------------------------------ public

    /** Force a refresh of the panel button visibility. Called by windowTracker. */
    refresh() {
        this._refreshButton();
    }

    restoreGroup(groupKey) {
        const groups = this._windowTracker.getActiveSnapGroups();
        const group = groups.get(groupKey);
        if (!group) return;

        for (const { metaWindow, entry } of group.members) {
            this._windowTracker._zoneManager.assignWindowToZone(
                metaWindow,
                entry.zoneRect
            );
        }

        // Focus the first window in the group
        if (group.members.length > 0) {
            const first = group.members[0].metaWindow;
            first.activate(global.display.get_current_time());
        }

        this._closePopup();
    }

    // ------------------------------------------------------------------ private — panel button

    _buildButton() {
        this._button = new St.Button({
            style_class: "wtc-groups-button panel-button",
            can_focus: true,
            reactive: true,
            x_expand: false,
        });

        const icon = new St.Icon({
            icon_name: "view-grid-symbolic",
            style_class: "system-status-icon",
        });
        this._button.set_child(icon);

        this._button.connect("clicked", () => {
            if (this._popupVisible)
                this._closePopup();
            else
                this._openPopup();
        });

        Main.panel._rightBox.insert_child_at_index(this._button, 0);
        this._button.hide();
    }

    _refreshButton() {
        if (!this._button) return;
        const groups = this._windowTracker.getActiveSnapGroups();
        if (groups.size > 0)
            this._button.show();
        else {
            this._button.hide();
            this._closePopup();
        }
    }

    // ------------------------------------------------------------------ private — popup

    _openPopup() {
        if (this._popup) this._closePopup();

        const groups = this._windowTracker.getActiveSnapGroups();
        if (groups.size === 0) return;

        this._popup = new St.BoxLayout({
            style_class: "wtc-groups-popup",
            vertical: true,
            reactive: true,
        });

        for (const [key, group] of groups) {
            const row = this._buildGroupRow(key, group);
            this._popup.add_child(row);
        }

        // Position below button
        const [bx, by] = this._button.get_transformed_position();
        const bh = this._button.height;
        this._popup.set_position(Math.max(0, bx - 100), by + bh + 4);

        Main.uiGroup.add_child(this._popup);
        this._animations.slideIn(this._popup, 0, -10);
        this._popupVisible = true;

        // Dismiss on outside click
        this._captureId = global.stage.connect("captured-event", (actor, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS)
                this._closePopup();
            return false;
        });
    }

    _buildGroupRow(key, group) {
        const row = new St.BoxLayout({
            style_class: "wtc-group-row",
            vertical: false,
            reactive: true,
            can_focus: true,
        });

        // App icons
        for (const { metaWindow } of group.members.slice(0, 4)) {
            const app = Shell.WindowTracker.get_default().get_window_app(metaWindow);
            const icon = new St.Icon({
                gicon: app?.get_icon() ?? null,
                icon_name: app ? null : "application-x-executable-symbolic",
                icon_size: 20,
                style_class: "wtc-group-icon",
            });
            row.add_child(icon);
        }

        if (group.members.length > 4) {
            row.add_child(new St.Label({
                text: `+${group.members.length - 4}`,
                style_class: "wtc-group-label",
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        row.connect("button-press-event", () => {
            this.restoreGroup(key);
            return true;
        });

        // Hover: highlight the row only (restoring the group is the click action).
        row.connect("enter-event", () => row.add_style_pseudo_class("hover"));
        row.connect("leave-event", () => row.remove_style_pseudo_class("hover"));

        return row;
    }

    _closePopup() {
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = null;
        }

        if (this._popup) {
            // Capture the current popup locally: a new popup may be opened
            // before this fade finishes, and we must not destroy that one.
            const popup = this._popup;
            this._popup = null;
            this._animations.fadeOut(popup, undefined, () => {
                popup.destroy();
            });
        }

        this._popupVisible = false;
    }
}
