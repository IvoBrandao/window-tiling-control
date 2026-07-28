/**
 * tests/maximizeHook.test.js
 *
 * Tests for MaximizeHook: bypass set, recentlyCreated set,
 * and the _onSizeChanged intercept guard logic.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals } from "./helpers/gnome-globals.js";
import { MaximizeHook } from "../src/maximizeHook.js";

// Meta.MaximizeFlags.BOTH = 3 (from stub)
const BOTH = 3;

function makeSettings(overrides = {}) {
    return { snapOverlayEnabled: true, ...overrides };
}

function makeSnapOverlay() {
    const calls = [];
    return {
        open: (win) => calls.push({ method: "open", win }),
        calls,
    };
}

function makeWindow({ maximized = false, resizable = true, movable = true } = {}) {
    let _maximized = maximized ? BOTH : 0;
    let unmaximizeCalled = false;
    return {
        get_id: () => 42,
        get_maximized: () => _maximized,
        allows_resize: () => resizable,
        allows_move: () => movable,
        unmaximize: () => { unmaximizeCalled = false; _maximized = 0; },
        // The idle callback now bails if the window has been finalized; a live
        // window returns a truthy compositor actor.
        get_compositor_private: () => ({}),
        is_hidden: () => false,
        _wasUnmaximized: () => unmaximizeCalled,
    };
}

// ── bypass ────────────────────────────────────────────────────────────────────

describe("MaximizeHook.bypass", () => {
    beforeEach(() => setupGnomeGlobals());

    it("adds windowId to _bypassed set", () => {
        const hook = new MaximizeHook(makeSettings(), makeSnapOverlay(), null);
        hook.bypass(99);
        assert.ok(hook._bypassed.has(99));
    });

    it("automatically removes windowId after ~500 ms (async)", async () => {
        const hook = new MaximizeHook(makeSettings(), makeSnapOverlay(), null);
        hook.bypass(99);
        // GLib.timeout_add in stub resolves via Promise.resolve
        await new Promise(r => setImmediate(r));
        assert.ok(!hook._bypassed.has(99), "should be removed after microtask flush");
    });
});

// ── recentlyCreated ───────────────────────────────────────────────────────────

describe("MaximizeHook — recently-created window guard", () => {
    beforeEach(() => setupGnomeGlobals());

    it("_onSizeChanged skips windows in _recentlyCreated", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        const win = makeWindow({ maximized: true });
        hook._recentlyCreated.add(win.get_id());

        hook._onSizeChanged({ meta_window: win });

        assert.equal(overlay.calls.length, 0, "overlay.open should NOT be called for new windows");
    });
});

// ── _onSizeChanged guard logic ────────────────────────────────────────────────

describe("MaximizeHook._onSizeChanged", () => {
    beforeEach(() => setupGnomeGlobals());

    it("does nothing when snapOverlayEnabled=false", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings({ snapOverlayEnabled: false }), overlay, null);
        const win = makeWindow({ maximized: true });
        hook._onSizeChanged({ meta_window: win });
        assert.equal(overlay.calls.length, 0);
    });

    it("does nothing when actor has no meta_window", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        hook._onSizeChanged({});
        assert.equal(overlay.calls.length, 0);
    });

    it("does nothing when window is not fully maximized", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        const win = makeWindow({ maximized: false });
        hook._onSizeChanged({ meta_window: win });
        assert.equal(overlay.calls.length, 0);
    });

    it("does nothing when windowId is bypassed", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        const win = makeWindow({ maximized: true });
        hook._bypassed.add(win.get_id());
        hook._onSizeChanged({ meta_window: win });
        assert.equal(overlay.calls.length, 0);
    });

    it("does nothing for non-resizable windows", () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        const win = makeWindow({ maximized: true, resizable: false, movable: false });
        hook._onSizeChanged({ meta_window: win });
        assert.equal(overlay.calls.length, 0);
    });

    it("opens the snap overlay for a normal maximized window", async () => {
        const overlay = makeSnapOverlay();
        const hook = new MaximizeHook(makeSettings(), overlay, null);
        const win = makeWindow({ maximized: true });

        // Must clear startup grace so the hook actually intercepts
        hook._startupGrace = false;

        hook._onSizeChanged({ meta_window: win });
        // overlay.open is called inside idle_add → microtask
        await new Promise(r => setImmediate(r));

        assert.equal(overlay.calls.length, 1);
        assert.equal(overlay.calls[0].method, "open");
    });
});

// ── enable / disable signal cleanup ──────────────────────────────────────────

describe("MaximizeHook — enable/disable", () => {
    it("enable adds signals, disable clears them", () => {
        setupGnomeGlobals();
        const hook = new MaximizeHook(makeSettings(), makeSnapOverlay(), null);
        hook.enable();
        assert.equal(hook._wmSignals.length, 1);
        // 3 display signals: window-created + grab-op-begin + grab-op-end
        assert.equal(hook._displaySignals.length, 3);

        hook.disable();
        assert.equal(hook._wmSignals.length, 0);
        assert.equal(hook._displaySignals.length, 0);
    });
});
