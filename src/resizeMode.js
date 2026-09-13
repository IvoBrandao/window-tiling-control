/**
 * WindowTilingControl — src/resizeMode.js
 * i3-style keyboard resize submode. Enter with a keybinding; arrow keys then
 * resize the focused window (its shared edges with snapped neighbours adjust
 * automatically via WindowTracker's resize propagation). Escape / Enter exit.
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

const KEY = {
    ESCAPE: 0xFF1B, RETURN: 0xFF0D, KP_ENTER: 0xFF8D,
    LEFT: 0xFF51, UP: 0xFF52, RIGHT: 0xFF53, DOWN: 0xFF54,
    r: 0x072, R: 0x052,
};

const STEP = 50;      // px per keypress
// px per keypress when Shift is held. Must stay ABOVE WindowTracker's
// resize-propagation tolerance (30px, see windowTracker.js _onWindowResized)
// — a fine step at or below that tolerance would be indistinguishable from
// "no real resize" on every single keypress, so a snapped window's shared
// edge with its neighbours would never actually propagate while fine-resizing.
const STEP_FINE = 40;
const MIN = 120;      // minimum window dimension

export class ResizeMode {
    constructor(settings, windowTracker, zoneManager, logger) {
        this._settings = settings;
        this._windowTracker = windowTracker;
        this._zoneManager = zoneManager;
        this._log = logger;

        this._actor = null;
        this._grab = null;
        this._hud = null;
        this._keyId = null;
        this._window = null;
    }

    isActive() {
        return !!this._actor;
    }

    toggle() {
        if (this._actor) this.exit();
        else this.enter();
    }

    enter() {
        if (this._actor) return;
        const win = global.display.get_focus_window();
        if (!win || !win.allows_resize?.()) return;
        this._window = win;

        // Transparent full-screen grabber so arrow keys don't reach apps.
        this._actor = new St.Widget({ reactive: true, can_focus: true, x: 0, y: 0 });
        this._actor.set_size(global.stage.width, global.stage.height);
        Main.uiGroup.add_child(this._actor);

        let grab = null;
        try {
            grab = Main.pushModal(this._actor, { actionMode: Shell.ActionMode.NORMAL });
        } catch (e) {
            this._log?.error(`ResizeMode: pushModal failed: ${e}`);
        }
        if (!grab) { this._teardown(); return; }
        this._grab = grab;

        this._actor.grab_key_focus();
        this._keyId = this._actor.connect("key-press-event", (_a, event) => {
            try { return this._onKey(event); }
            catch (e) { this._log?.error(`ResizeMode key: ${e}`); return Clutter.EVENT_STOP; }
        });

        this._showHud();
    }

    exit() {
        if (!this._actor) return;
        if (this._keyId) { try { this._actor.disconnect(this._keyId); } catch (_) {} this._keyId = null; }
        if (this._grab) { try { Main.popModal(this._grab); } catch (_) {} this._grab = null; }
        this._teardown();
    }

    destroy() {
        this.exit();
    }

    // ------------------------------------------------------------------ private

    _teardown() {
        this._hideHud();
        if (this._actor) {
            try { Main.uiGroup.remove_child(this._actor); this._actor.destroy(); } catch (_) {}
            this._actor = null;
        }
        this._window = null;
    }

    _onKey(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state?.() ?? 0;
        const shift = !!(state & Clutter.ModifierType.SHIFT_MASK);
        const step = shift ? STEP_FINE : STEP;

        if (sym === KEY.ESCAPE || sym === KEY.RETURN || sym === KEY.KP_ENTER ||
            sym === KEY.r || sym === KEY.R) {
            this.exit();
            return Clutter.EVENT_STOP;
        }

        let dw = 0, dh = 0;
        switch (sym) {
            case KEY.RIGHT: dw =  step; break;
            case KEY.LEFT:  dw = -step; break;
            case KEY.DOWN:  dh =  step; break;
            case KEY.UP:    dh = -step; break;
            default: return Clutter.EVENT_PROPAGATE;
        }

        this._resizeBy(dw, dh);
        return Clutter.EVENT_STOP;
    }

    _resizeBy(dw, dh) {
        const win = this._window;
        if (!win || !win.get_compositor_private?.()) { this.exit(); return; }

        const r = win.get_frame_rect();
        const wa = this._zoneManager?._getWorkarea?.(win.get_monitor());

        // Which edges already sit on the workarea boundary? The edge that
        // ISN'T on the boundary is the one that's either free-floating or
        // shares a border with a tiled neighbour, so that's the edge that
        // should move — anchoring the boundary edge in place. Without this,
        // resize always grew/shrank the right/bottom edge regardless of
        // layout, so a window whose SHARED border with its neighbour was on
        // its left or top (e.g. the right half of a halves split, or a
        // top-right/bottom-right quarter) could never have that border
        // resized at all — only its already-fixed screen-edge side moved.
        // Purely geometry-based (current frame vs. workarea), so it works
        // for every preset — halves, quarters, thirds, sixths, custom zones
        // — not just the slots directionalMove.js knows how to name.
        const EDGE_TOL = 4;
        const leftIsOuter   = !!wa && Math.abs(r.x - wa.x) < EDGE_TOL;
        const rightIsOuter  = !!wa && Math.abs((r.x + r.width)  - (wa.x + wa.width))  < EDGE_TOL;
        const topIsOuter    = !!wa && Math.abs(r.y - wa.y) < EDGE_TOL;
        const bottomIsOuter = !!wa && Math.abs((r.y + r.height) - (wa.y + wa.height)) < EDGE_TOL;

        // If neither (or both) edge on an axis is outer — a free-floating
        // window, or one already spanning the full width/height — fall back
        // to the classic anchor-top-left behaviour.
        const anchorRight  = rightIsOuter && !leftIsOuter;
        const anchorBottom = bottomIsOuter && !topIsOuter;

        let width  = Math.max(MIN, r.width  + dw);
        let height = Math.max(MIN, r.height + dh);
        let x = anchorRight  ? r.x + (r.width  - width)  : r.x;
        let y = anchorBottom ? r.y + (r.height - height) : r.y;

        // Keep the window within the workarea — clamp whichever edge is free
        // to move (the anchored edge is, by construction, already on it).
        if (wa) {
            if (anchorRight) { x = Math.max(x, wa.x); width  = (r.x + r.width)  - x; }
            else width  = Math.min(width,  wa.x + wa.width  - x);

            if (anchorBottom) { y = Math.max(y, wa.y); height = (r.y + r.height) - y; }
            else height = Math.min(height, wa.y + wa.height - y);
        }

        // Snapped neighbours that share the moved edge follow via
        // WindowTracker's size-changed → _propagateResize.
        win.move_resize_frame(true, x, y, width, height);
    }

    _showHud() {
        this._hud = new St.BoxLayout({ style_class: "wtc-resize-hud", vertical: false });
        this._hud.add_child(new St.Label({
            text: _("Resize mode — arrows resize · Shift = fine · Esc to exit"),
            style_class: "wtc-resize-hud-label",
        }));
        Main.uiGroup.add_child(this._hud);
        this._hud.ensure_style();
        const mon = this._window?.get_monitor() ?? global.display.get_current_monitor();
        const geom = global.display.get_monitor_geometry(mon);
        this._hud.set_position(
            Math.round(geom.x + (geom.width - (this._hud.width || 420)) / 2),
            Math.round(geom.y + 40)
        );
    }

    _hideHud() {
        if (this._hud) {
            try { Main.uiGroup.remove_child(this._hud); this._hud.destroy(); } catch (_) {}
            this._hud = null;
        }
    }
}
