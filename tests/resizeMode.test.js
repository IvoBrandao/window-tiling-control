/**
 * tests/resizeMode.test.js
 *
 * Tests for src/resizeMode.js — the Super+R keyboard-resize submode.
 *
 * Covers: enter/exit lifecycle, modal grab acquisition/release, key handling
 * (including the regression test for the STEP_FINE/tolerance bug below),
 * workarea clamping, and the minimum-dimension floor.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { ResizeMode } from "../src/resizeMode.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings() {
    return {};
}

function makeZoneManager(workarea = new Rect(0, 0, 1920, 1080)) {
    return { _getWorkarea: () => workarea };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

function makeWindow({ x = 100, y = 100, width = 400, height = 300, monitor = 0, resizable = true } = {}) {
    const rect = { x, y, width, height };
    return {
        get_frame_rect: () => rect,
        get_monitor: () => monitor,
        get_compositor_private: () => ({}),
        allows_resize: () => resizable,
        move_resize_frame: (_userOp, nx, ny, nw, nh) => {
            rect.x = nx; rect.y = ny; rect.width = nw; rect.height = nh;
        },
        _rect: rect,
    };
}

/** A fake Clutter key event. */
function keyEvent(sym, { shift = false } = {}) {
    return {
        get_key_symbol: () => sym,
        get_state: () => (shift ? 1 /* Clutter.ModifierType.SHIFT_MASK */ : 0),
    };
}

const KEY = {
    ESCAPE: 0xFF1B, LEFT: 0xFF51, UP: 0xFF52, RIGHT: 0xFF53, DOWN: 0xFF54,
};

describe("ResizeMode", () => {
    let display;

    beforeEach(() => {
        ({ display } = setupGnomeGlobals());
        globalThis.__wtcMainSet__("uiGroup", {
            _children: [],
            add_child: function (c) { this._children.push(c); },
            remove_child: function (c) { this._children = this._children.filter(x => x !== c); },
            contains: function (c) { return this._children.includes(c); },
        });
    });

    // Main.pushModal/popModal are module-level bindings shared across every
    // test in this file (and any other file importing Main in the same
    // process) — tests that override them must not leak that override.
    afterEach(() => {
        globalThis.__wtcMainSet__("pushModal", (actor, params) => ({ actor, params, dismiss() {} }));
        globalThis.__wtcMainSet__("popModal", () => {});
    });

    describe("enter/exit lifecycle", () => {
        it("does nothing when there is no focused window", () => {
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            assert.equal(rm.isActive(), false);
        });

        it("does nothing when the focused window does not allow resize", () => {
            display._setFocusWindow(makeWindow({ resizable: false }));
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            assert.equal(rm.isActive(), false);
        });

        it("becomes active and acquires a modal grab on enter", () => {
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            assert.equal(rm.isActive(), true);
            assert.ok(rm._grab, "should hold a grab handle");
        });

        it("is idempotent: calling enter() twice does not re-grab", () => {
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            const grab1 = rm._grab;
            rm.enter();
            assert.equal(rm._grab, grab1, "second enter() must be a no-op");
        });

        it("releases the modal grab on exit", () => {
            let dismissed = false;
            let popped = false;
            globalThis.__wtcMainSet__("pushModal", () => ({ dismiss: () => { dismissed = true; } }));
            globalThis.__wtcMainSet__("popModal", () => { popped = true; });

            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm.exit();

            assert.equal(rm.isActive(), false);
            assert.equal(popped, true, "Main.popModal must be called on exit");
        });

        it("exit() is safe to call when not active", () => {
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            assert.doesNotThrow(() => rm.exit());
        });

        it("tears down cleanly if the grab cannot be acquired", () => {
            globalThis.__wtcMainSet__("pushModal", () => null);
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            assert.equal(rm.isActive(), false);
        });

        it("destroy() releases an active grab (disable-mid-mode safety)", () => {
            let popped = false;
            globalThis.__wtcMainSet__("popModal", () => { popped = true; });
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm.destroy();
            assert.equal(rm.isActive(), false);
            assert.equal(popped, true);
        });

        it("toggle() enters when inactive and exits when active", () => {
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.toggle();
            assert.equal(rm.isActive(), true);
            rm.toggle();
            assert.equal(rm.isActive(), false);
        });
    });

    describe("key handling", () => {
        it("Escape exits resize mode", () => {
            display._setFocusWindow(makeWindow());
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.ESCAPE));
            assert.equal(rm.isActive(), false);
        });

        it("Right arrow grows the window width by the normal step", () => {
            const win = makeWindow({ width: 400 });
            display._setFocusWindow(win);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT));
            assert.equal(win._rect.width, 450); // STEP = 50
        });

        it("Down arrow grows the window height by the normal step", () => {
            const win = makeWindow({ height: 300 });
            display._setFocusWindow(win);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.DOWN));
            assert.equal(win._rect.height, 350); // STEP = 50
        });

        it("Left arrow shrinks width but never below the minimum dimension", () => {
            const win = makeWindow({ width: 140 });
            display._setFocusWindow(win);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.LEFT));
            assert.equal(win._rect.width, 120); // MIN = 120, floor applied
        });

        // ── Regression: STEP_FINE vs WindowTracker's 30px propagation tolerance ──
        //
        // windowTracker.js's _onWindowResized only treats a size change as a
        // real resize (and propagates it to snapped neighbours) once the
        // delta from the window's tracked zone rect exceeds a 30px tolerance.
        // STEP_FINE used to be 20px — every single Shift-held resize keypress
        // on a snapped window was therefore silently swallowed by that
        // tolerance check and NEVER reached a snapped neighbour. STEP_FINE
        // must stay strictly greater than that tolerance.
        it("the fine (Shift) resize step exceeds WindowTracker's 30px propagation tolerance", () => {
            const win = makeWindow({ width: 400 });
            display._setFocusWindow(win);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT, { shift: true }));

            const delta = win._rect.width - 400;
            assert.ok(delta > 30, `fine resize step (${delta}px) must exceed the 30px tolerance`);
        });

        it("resizing is clamped to the monitor's workarea", () => {
            const win = makeWindow({ x: 1800, y: 0, width: 100, height: 100 });
            display._setFocusWindow(win);
            const wa = new Rect(0, 0, 1920, 1080);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(wa), makeLogger());
            rm.enter();
            rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT)); // would overflow past x=1920

            assert.ok(win._rect.x + win._rect.width <= 1920,
                `right edge (${win._rect.x + win._rect.width}) must not exceed the workarea`);
        });

        // ── Regression: resize must move a window's SHARED edge, not always
        // its right/bottom edge, so the shared border of a right-half /
        // right-quarter window can actually be resized. ────────────────────
        describe("anchored (shared-edge) resize", () => {
            it("resizes from the LEFT edge when the window's right edge is on the workarea boundary", () => {
                // Right half of a 1920-wide workarea: right edge sits exactly
                // on the boundary, left edge is the one shared with a neighbour.
                const win = makeWindow({ x: 1500, y: 100, width: 420, height: 300 });
                display._setFocusWindow(win);
                const wa = new Rect(0, 0, 1920, 1080);
                const rm = new ResizeMode(makeSettings(), null, makeZoneManager(wa), makeLogger());
                rm.enter();
                rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT)); // "grow"

                assert.equal(win._rect.width, 470, "should grow by STEP");
                assert.equal(win._rect.x, 1450, "left (shared) edge should move");
                assert.equal(win._rect.x + win._rect.width, 1920, "right (outer) edge must stay put");
            });

            it("resizes from the TOP edge when the window's bottom edge is on the workarea boundary", () => {
                const win = makeWindow({ x: 0, y: 780, width: 400, height: 300 });
                display._setFocusWindow(win);
                const wa = new Rect(0, 0, 1920, 1080);
                const rm = new ResizeMode(makeSettings(), null, makeZoneManager(wa), makeLogger());
                rm.enter();
                rm._actor.emit("key-press-event", keyEvent(KEY.DOWN)); // "grow"

                assert.equal(win._rect.height, 350, "should grow by STEP");
                assert.equal(win._rect.y, 730, "top (shared) edge should move");
                assert.equal(win._rect.y + win._rect.height, 1080, "bottom (outer) edge must stay put");
            });

            it("anchors both right and bottom edges for a bottom-right quarter", () => {
                const win = makeWindow({ x: 1520, y: 780, width: 400, height: 300 });
                display._setFocusWindow(win);
                const wa = new Rect(0, 0, 1920, 1080);
                const rm = new ResizeMode(makeSettings(), null, makeZoneManager(wa), makeLogger());
                rm.enter();
                rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT));
                rm._actor.emit("key-press-event", keyEvent(KEY.DOWN));

                assert.equal(win._rect.x + win._rect.width, 1920, "right edge must stay anchored");
                assert.equal(win._rect.y + win._rect.height, 1080, "bottom edge must stay anchored");
                assert.ok(win._rect.x < 1520, "left edge should have moved outward");
                assert.ok(win._rect.y < 780, "top edge should have moved outward");
            });

            it("never grows the anchored (outer) edge past the workarea when shrinking to the minimum", () => {
                const win = makeWindow({ x: 1780, y: 100, width: 140, height: 300 });
                display._setFocusWindow(win);
                const wa = new Rect(0, 0, 1920, 1080);
                const rm = new ResizeMode(makeSettings(), null, makeZoneManager(wa), makeLogger());
                rm.enter();
                rm._actor.emit("key-press-event", keyEvent(KEY.LEFT)); // "shrink"

                assert.equal(win._rect.width, 120, "MIN floor applies");
                assert.equal(win._rect.x + win._rect.width, 1920, "right edge must stay anchored while shrinking too");
            });
        });

        it("exits gracefully if the window is destroyed mid-mode", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            const rm = new ResizeMode(makeSettings(), null, makeZoneManager(), makeLogger());
            rm.enter();
            win.get_compositor_private = () => null; // simulate the window closing
            rm._actor.emit("key-press-event", keyEvent(KEY.RIGHT));
            assert.equal(rm.isActive(), false);
        });
    });
});
