/**
 * WindowTilingControl — src/roundedCorners.js
 * Applies rounded corners to all normal windows by adding a Clutter effect
 * that clips the window actor's texture with a rounded rectangle.
 *
 * Uses a GLSL snippet effect attached to each window actor.  The effect is
 * added/removed dynamically so it can be toggled at runtime.
 */

import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Clutter from "gi://Clutter";

/**
 * Rounded-corner snippet effect.
 * Uses the Clutter.OffscreenEffect pipeline to clip each window frame to a
 * rounded rectangle via a GLSL fragment shader.
 */
const EFFECT_NAME = "wtc-rounded-corners";

// Window types that should get rounded corners. Restricting this to NORMAL
// alone excludes Settings panels, Nautilus/GTK4 file-chooser and properties
// dialogs, and other regular CSD dialog windows — all of which are ordinary
// top-level windows a user tiles and looks at just as often as an app's main
// window, so they should not stand out with square corners.
const ROUNDABLE_WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

const ROUNDED_CORNERS_GLSL = `
uniform float radius;
uniform float width;
uniform float height;

void main() {
    vec2 coord = cogl_tex_coord_in[0].xy * vec2(width, height);
    vec4 color = texture2D(cogl_sampler0, cogl_tex_coord_in[0].xy);

    // Distance from nearest corner
    vec2 fromCorner = min(coord, vec2(width, height) - coord);
    if (fromCorner.x < radius && fromCorner.y < radius) {
        float dist = length(vec2(radius, radius) - fromCorner);
        if (dist > radius) {
            color.a = 0.0;
        } else if (dist > radius - 1.0) {
            color.a *= (radius - dist);
        }
    }
    cogl_color_out = color;
}
`;

export class RoundedCorners {
    constructor(settings, logger) {
        this._settings = settings;
        this._log = logger;
        this._signalIds = [];
        this._settingsSignalIds = [];
        this._pendingSources = new Set();
        this._enabled = false;
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;

        if (!this._settings.roundedCornersEnabled) {
            this._watchSettings();
            return;
        }

        this._applyToAll();
        this._connectWindowSignals();
        this._watchSettings();
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        this._unwatchSettings();
        this._disconnectWindowSignals();
        for (const id of this._pendingSources)
            try { GLib.Source.remove(id); } catch (_) {}
        this._pendingSources.clear();
        this._removeFromAll();
    }

    // ------------------------------------------------------------------ private

    _watchSettings() {
        this._settingsSignalIds.push(
            this._settings.connect("changed::rounded-corners-enabled", () => {
                if (this._settings.roundedCornersEnabled) {
                    this._applyToAll();
                    this._connectWindowSignals();
                } else {
                    this._disconnectWindowSignals();
                    this._removeFromAll();
                }
            }),
            this._settings.connect("changed::rounded-corners-radius", () => {
                if (this._settings.roundedCornersEnabled)
                    this._updateAll();
            })
        );
    }

    _unwatchSettings() {
        for (const id of this._settingsSignalIds)
            this._settings.disconnect(id);
        this._settingsSignalIds = [];
    }

    _connectWindowSignals() {
        this._disconnectWindowSignals();
        this._signalIds.push(
            global.display.connect("window-created", (_dpy, metaWindow) => {
                let sid;
                sid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._pendingSources.delete(sid);
                    this._applyToWindow(metaWindow);
                    return GLib.SOURCE_REMOVE;
                });
                this._pendingSources.add(sid);
            })
        );
    }

    _disconnectWindowSignals() {
        for (const id of this._signalIds)
            try { global.display.disconnect(id); } catch (_) {}
        this._signalIds = [];

        // Drop the per-window handlers connected in _applyToWindow.
        for (const actor of global.get_window_actors?.() ?? []) {
            const ids = actor._wtcRCSignals;
            if (!ids) continue;
            const win = actor.meta_window;
            for (const id of ids)
                try { win?.disconnect(id); } catch (_) {}
            actor._wtcRCSignals = null;
        }
    }

    _getAllWindows() {
        return (global.get_window_actors?.() ?? [])
            .map(a => a.meta_window)
            .filter(w => w && ROUNDABLE_WINDOW_TYPES.has(w.get_window_type()));
    }

    _applyToAll() {
        for (const win of this._getAllWindows())
            this._applyToWindow(win);
    }

    _removeFromAll() {
        for (const actor of global.get_window_actors?.() ?? [])
            this._removeFromActor(actor);
    }

    _updateAll() {
        for (const win of this._getAllWindows())
            this._applyToWindow(win);
    }

    _applyToWindow(metaWindow) {
        if (!metaWindow || !ROUNDABLE_WINDOW_TYPES.has(metaWindow.get_window_type()))
            return;

        // Don't round maximized or fullscreen windows
        try {
            const maximized = metaWindow.get_maximized?.() ?? metaWindow.get_maximize_flags?.();
            if (maximized === Meta.MaximizeFlags.BOTH) {
                const actor = metaWindow.get_compositor_private();
                if (actor) this._removeFromActor(actor);
                return;
            }
        } catch (_) {}

        if (metaWindow.is_fullscreen?.()) {
            const actor = metaWindow.get_compositor_private();
            if (actor) this._removeFromActor(actor);
            return;
        }

        const actor = metaWindow.get_compositor_private();
        if (!actor) return;

        this._applyToActor(actor);

        // Watch for maximize/unmaximize to toggle the effect
        if (!actor._wtcRCSignals) {
            actor._wtcRCSignals = [];
            try {
                actor._wtcRCSignals.push(
                    metaWindow.connect("notify::maximized-horizontally", () => {
                        this._onWindowStateChanged(metaWindow);
                    }),
                    metaWindow.connect("notify::maximized-vertically", () => {
                        this._onWindowStateChanged(metaWindow);
                    })
                );
            } catch (_) {
                // Some GNOME versions may not have these notify signals
            }

            // Also watch size changes to update the effect dimensions
            try {
                actor._wtcRCSignals.push(
                    metaWindow.connect("size-changed", () => {
                        if (this._settings.roundedCornersEnabled)
                            this._applyToActor(actor);
                    })
                );
            } catch (_) {}

            // Guard the "destroy" hookup with its own flag, separate from
            // _wtcRCSignals: disable() nulls _wtcRCSignals on every
            // enable/disable cycle, and without this flag a window that
            // survives multiple cycles would re-enter this `if` block each
            // time and accumulate one extra "destroy" listener per cycle.
            if (!actor._wtcRCDestroyHooked) {
                actor._wtcRCDestroyHooked = true;
                actor.connect("destroy", () => {
                    if (actor._wtcRCSignals) {
                        for (const id of actor._wtcRCSignals) {
                            try { metaWindow.disconnect(id); } catch (_) {}
                        }
                        actor._wtcRCSignals = null;
                    }
                });
            }
        }
    }

    _onWindowStateChanged(metaWindow) {
        if (!this._settings.roundedCornersEnabled) return;
        // Brief delay for the state to settle
        let sid;
        sid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._pendingSources.delete(sid);
            this._applyToWindow(metaWindow);
            return GLib.SOURCE_REMOVE;
        });
        this._pendingSources.add(sid);
    }

    _applyToActor(actor) {
        const radius = this._settings.roundedCornersRadius;
        const rect = actor.meta_window?.get_frame_rect();
        if (!rect) return;

        // Remove existing effect first
        this._removeFromActor(actor);

        try {
            const effect = new Clutter.ShaderEffect({
                shader_type: Clutter.ShaderType.FRAGMENT_SHADER,
            });
            effect.set_shader_source(ROUNDED_CORNERS_GLSL);
            effect.set_uniform_value("radius", radius);
            effect.set_uniform_value("width", rect.width);
            effect.set_uniform_value("height", rect.height);

            actor.add_effect_with_name(EFFECT_NAME, effect);
        } catch (e) {
            this._log?.debug(`RoundedCorners: could not apply effect: ${e.message}`);
        }
    }

    _removeFromActor(actor) {
        try {
            const existing = actor.get_effect(EFFECT_NAME);
            if (existing)
                actor.remove_effect(existing);
        } catch (_) {}
    }
}
