/**
 * Window Tiling Control — src/animations.js
 * Mutter animation helpers for all Window Tiling Control overlays and window transitions.
 *
 * NOTE: gi://Clutter is Mutter's own bundled compositor library — it is NOT
 * the deprecated standalone upstream Clutter project. It is the correct API
 * for actor animations inside GNOME Shell 45-49. actor.ease() is the modern
 * approach (replaces the old Clutter.Animation/Clutter.Timeline API).
 *
 * animation-speed GSettings values:
 *   0 = Off  (instant)
 *   1 = Fast (100 ms)
 *   2 = Normal (200 ms)  ← default
 *   3 = Slow (400 ms)
 */

import Clutter from "gi://Clutter";

const SPEED_MAP = [0, 100, 200, 400]; // indexed by animation-speed value

export class Animations {
    constructor(settings) {
        this._settings = settings;
    }

    /** Duration in ms respecting the master toggle and the global speed setting. */
    get duration() {
        // Master switch: when animations are disabled everything is instant,
        // regardless of the speed setting.
        if (this._settings?.animationsEnabled === false) return 0;
        const speed = this._settings?.animationSpeed ?? 2;
        return SPEED_MAP[speed] ?? 200;
    }

    /**
     * Fade an actor in from opacity 0 → 255.
     * The actor must already be visible (show() it first).
     */
    fadeIn(actor, durationMs = this.duration) {
        if (!actor) return;
        if (durationMs === 0) {
            actor.opacity = 255;
            return;
        }
        actor.opacity = 0;
        actor.ease({
            opacity: 255,
            duration: durationMs,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    /**
     * Fade an actor out from 255 → 0, then hide it.
     * @param {Function} [onComplete] - called after fade finishes
     */
    fadeOut(actor, durationMs = this.duration, onComplete = null) {
        if (!actor) return;
        if (durationMs === 0) {
            actor.opacity = 0;
            actor.hide();
            onComplete?.();
            return;
        }
        actor.ease({
            opacity: 0,
            duration: durationMs,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                // The actor may have been destroyed by another code path
                // (clearAll/close) while the fade was in flight.
                try {
                    actor.hide();
                    onComplete?.();
                } catch (_) {}
            },
        });
    }

    /**
     * Slide an actor in: it starts at (fromOffsetX, fromOffsetY) relative to
     * its final position, then glides to (0, 0).
     * The actor should be positioned at its final coordinates already.
     */
    slideIn(actor, fromOffsetX = 0, fromOffsetY = -20, durationMs = this.duration) {
        if (!actor) return;
        if (durationMs === 0) return;

        const origX = actor.x;
        const origY = actor.y;
        actor.set_position(origX + fromOffsetX, origY + fromOffsetY);
        actor.opacity = 0;
        actor.ease({
            x: origX,
            y: origY,
            opacity: 255,
            duration: durationMs,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    /**
     * Brief scale pulse: shrinks slightly then springs back to 1.0.
     * Gives satisfying "snap" feedback when a window is snapped to a zone.
     */
    scaleSnap(actor, durationMs = this.duration) {
        if (!actor) return;
        if (durationMs === 0) return;

        const half = Math.max(durationMs / 2, 50);
        actor.ease({
            scale_x: 0.95,
            scale_y: 0.95,
            duration: half,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                try {
                    actor.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: half,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                } catch (_) {}
            },
        });
    }

    /**
     * Smoothly animate a window actor from fromRect to its final snapped
     * position, then apply the real move_resize_frame at the end.
     *
     * This works by tweening the compositor actor position/size while the window
     * meta rect is still at fromRect, then snapping at the end.
     *
     * @param {Meta.Window} metaWindow
     * @param {Meta.Rectangle} fromRect  - current window rect before snap
     * @param {Meta.Rectangle} toRect    - target snap rect
     * @param {Function} onComplete      - called when tween finishes; should
     *                                     call metaWindow.move_resize_frame()
     */
    easeRect(metaWindow, fromRect, toRect, onComplete, durationMs = this.duration) {
        if (!metaWindow) return;

        const actor = metaWindow.get_compositor_private();
        if (!actor || durationMs === 0) {
            onComplete?.();
            return;
        }

        // Animate the Clutter actor to the target rect
        actor.ease({
            x: toRect.x,
            y: toRect.y,
            width: toRect.width,
            height: toRect.height,
            duration: durationMs,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                // The actual window geometry change — actor will be reset by
                // the compositor after move_resize_frame.
                try { onComplete?.(); } catch (_) {}
            },
        });
    }
}
