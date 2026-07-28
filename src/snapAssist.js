/**
 * WindowTilingControl — src/snapAssist.js
 * After a window is snapped to the first zone of a multi-zone preset,
 * shows a thumbnail picker overlay on each remaining zone so the user
 * can quickly fill the layout.
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

const MAX_THUMBNAILS = 8;
const THUMB_W = 120;
const THUMB_H = 72;

export class SnapAssist {
    constructor(settings, windowTracker, zoneManager, animations, logger) {
        this._settings = settings;
        this._windowTracker = windowTracker;
        this._zoneManager = zoneManager;
        this._animations = animations;
        this._log = logger;

        /** @type {St.BoxLayout[]} */
        this._overlays = [];
        this._dismissTimerId = null;
        this._focusSignalId = null;
        /** Window ids we're offering as thumbnails — focusing one is expected. */
        this._offeredIds = new Set();
        /** Monotonic time before which focus changes are ignored (arming). */
        this._armedUntil = 0;
    }

    // ------------------------------------------------------------------ public

    /**
     * Show thumbnail pickers for each remaining zone.
     *
     * @param {string} presetId
     * @param {number} monitorIndex
     * @param {number} workspaceIndex
     * @param {{ rect: Meta.Rectangle, zoneIndex: number }[]} remainingZones
     */
    show(presetId, monitorIndex, workspaceIndex, remainingZones) {
        if (!this._settings.snapAssistEnabled) return;
        this.destroyAll();

        const unsnapped = this._windowTracker.getUnsnappedWindows(monitorIndex, workspaceIndex);
        if (unsnapped.length === 0) return;

        this._offeredIds = new Set(unsnapped.map(w => w.get_id()));

        for (const zone of remainingZones) {
            const overlay = this._buildOverlay(
                presetId, monitorIndex, workspaceIndex, zone, unsnapped
            );
            if (overlay) this._overlays.push(overlay);
        }

        this._startDismissTimer();

        // Grace period so the just-snapped window's settling focus doesn't
        // immediately dismiss the previews.
        this._armedUntil = GLib.get_monotonic_time() + 700 * 1000; // 700ms

        // After arming, dismiss only when the user deliberately focuses a window
        // that ISN'T one of the thumbnails we're offering (i.e. they moved on).
        if (this._focusSignalId === null) {
            this._focusSignalId = global.display.connect(
                "notify::focus-window",
                () => {
                    if (GLib.get_monotonic_time() < this._armedUntil) return;
                    const fw = global.display.get_focus_window();
                    if (!fw) return;
                    if (this._offeredIds.has(fw.get_id())) return;
                    this.destroyAll();
                }
            );
        }
    }

    destroyAll() {
        this._stopDismissTimer();
        this._offeredIds.clear();
        this._armedUntil = 0;

        if (this._focusSignalId !== null) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = null;
        }
        for (const overlay of this._overlays) {
            if (Main.uiGroup.contains(overlay)) {
                this._animations.fadeOut(overlay, undefined, () => {
                    Main.uiGroup.remove_child(overlay);
                    overlay.destroy();
                });
            }
        }
        this._overlays = [];
    }

    destroy() {
        this.destroyAll();
    }

    // ------------------------------------------------------------------ private — overlay

    _buildOverlay(presetId, monitorIndex, workspaceIndex, zone, unsnapped) {
        const overlay = new St.BoxLayout({
            style_class: "wtc-snap-assist",
            vertical: true,
            reactive: true,
        });

        const title = new St.Label({
            text: _("Snap a window here"),
            style_class: "wtc-snap-assist-title",
            x_align: Clutter.ActorAlign.CENTER,
        });
        overlay.add_child(title);

        const scrollBox = new St.ScrollView({
            x_expand: true,
            y_expand: true,
        });
        const thumbBox = new St.BoxLayout({
            style_class: "wtc-snap-assist-thumbs",
            vertical: true,
        });

        const displayed = unsnapped.slice(0, MAX_THUMBNAILS);
        for (const win of displayed) {
            const thumb = this._buildThumbnail(
                win, presetId, monitorIndex, workspaceIndex, zone
            );
            thumbBox.add_child(thumb);
        }

        if (unsnapped.length > MAX_THUMBNAILS) {
            const overflow = new St.Label({
                text: `+${unsnapped.length - MAX_THUMBNAILS} ${_("more")}`,
                style_class: "wtc-snap-assist-overflow",
                x_align: Clutter.ActorAlign.CENTER,
            });
            thumbBox.add_child(overflow);
        }

        scrollBox.add_child(thumbBox);
        overlay.add_child(scrollBox);

        // Position centered inside the zone rect
        const r = zone.rect;
        const maxW = Math.min(THUMB_W + 24, r.width - 20);
        const maxH = Math.min((THUMB_H + 8) * Math.min(displayed.length, 3) + 40, r.height - 20);
        overlay.width  = maxW;
        overlay.height = maxH;

        Main.uiGroup.add_child(overlay);
        overlay.set_position(
            Math.round(r.x + (r.width - maxW) / 2),
            Math.round(r.y + (r.height - maxH) / 2)
        );
        this._animations.slideIn(overlay, 0, 12);

        return overlay;
    }

    _buildThumbnail(metaWindow, presetId, monitorIndex, workspaceIndex, zone) {
        const btn = new St.Button({
            style_class: "wtc-snap-assist-thumb",
            reactive: true,
            can_focus: true,
        });

        const inner = new St.BoxLayout({ vertical: false });

        // Try Clutter.Clone of window actor
        const winActor = metaWindow.get_compositor_private();
        const sw = winActor?.width  ?? 0;
        const sh = winActor?.height ?? 0;
        if (winActor && sw > 0 && sh > 0) {
            try {
                // Clutter.Clone scales its source to fit its own allocation, so
                // we only set the target width/height — NOT set_scale as well,
                // which would compound the transform and shrink it to nothing.
                const scale = Math.min((THUMB_W - 8) / sw, (THUMB_H - 8) / sh);
                const clone = new Clutter.Clone({
                    source: winActor,
                    width:  Math.max(Math.round(sw * scale), 1),
                    height: Math.max(Math.round(sh * scale), 1),
                });
                inner.add_child(clone);
            } catch (_) {
                inner.add_child(this._buildFallbackThumb(metaWindow));
            }
        } else {
            // No mapped compositor actor (minimized/other workspace) — icon only.
            inner.add_child(this._buildFallbackThumb(metaWindow));
        }

        btn.set_child(inner);

        btn.connect("clicked", () => {
            this._onThumbnailClicked(metaWindow, presetId, monitorIndex, workspaceIndex, zone);
        });

        // Reset dismiss timer on interaction
        btn.connect("enter-event", () => this._resetDismissTimer());

        return btn;
    }

    _buildFallbackThumb(metaWindow) {
        const box = new St.BoxLayout({ vertical: false });
        const app = Shell.WindowTracker.get_default().get_window_app(metaWindow);

        const icon = new St.Icon({
            gicon: app?.get_icon() ?? null,
            icon_name: app ? null : "application-x-executable-symbolic",
            icon_size: 32,
        });
        box.add_child(icon);

        const title = metaWindow.get_title() ?? "";
        const label = new St.Label({
            text: title.length > 28 ? `${title.slice(0, 28)}…` : title,
            style_class: "wtc-snap-assist-label",
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(label);
        return box;
    }

    // ------------------------------------------------------------------ private — interaction

    _onThumbnailClicked(metaWindow, presetId, monitorIndex, workspaceIndex, zone) {
        this._stopDismissTimer();

        this._windowTracker.snapWindow(
            metaWindow, presetId, zone.zoneIndex, zone.rect
        );

        // Remove this overlay; remaining zones will be re-triggered by
        // windowTracker.snapWindow → snapAssist.show() if any unfilled zones remain.
        this.destroyAll();
    }

    // ------------------------------------------------------------------ private — auto-dismiss

    _startDismissTimer() {
        this._resetDismissTimer();
    }

    _resetDismissTimer() {
        this._stopDismissTimer();
        const timeout = (this._settings.snapAssistTimeout ?? 8) * 1000;
        this._dismissTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
            // Clear the id first: destroyAll() calls _stopDismissTimer(), and
            // removing the source that is currently firing would double-remove.
            this._dismissTimerId = null;
            this.destroyAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopDismissTimer() {
        if (this._dismissTimerId) {
            GLib.Source.remove(this._dismissTimerId);
            this._dismissTimerId = null;
        }
    }
}
