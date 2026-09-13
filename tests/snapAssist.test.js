/**
 * tests/snapAssist.test.js
 *
 * Tests for src/snapAssist.js — thumbnail picker lifecycle,
 * auto-dismiss timer, overflow labels, and window snapping on click.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { SnapAssist } from "../src/snapAssist.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        snapAssistEnabled: true,
        snapAssistTimeout: 8,
        ...overrides,
    };
}

function makeWindowTracker(unsnapped = []) {
    const calls = [];
    return {
        getUnsnappedWindows: () => unsnapped,
        snapWindow: (...args) => calls.push(["snapWindow", ...args]),
        _calls: calls,
    };
}

function makeZoneManager() {
    return {
        getZoneRects: () => [
            new Rect(0, 0, 960, 1080),
            new Rect(960, 0, 960, 1080),
        ],
    };
}

function makeAnimations() {
    return {
        slideIn: () => {},
        fadeIn: () => {},
        fadeOut: (_actor, _dur, cb) => cb?.(),
        scaleSnap: () => {},
    };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

function makeWindow(id = 1) {
    return {
        get_id: () => id,
        get_monitor: () => 0,
        get_title: () => `Window ${id}`,
        get_compositor_private: () => null,
        get_workspace: () => ({ index: () => 0 }),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SnapAssist", () => {
    let assist, settings, windowTracker, zoneManager, animations;

    beforeEach(() => {
        setupGnomeGlobals();

        globalThis.__wtcMainSet__("uiGroup", {
            _children: [],
            add_child: function (c) { this._children.push(c); },
            remove_child: function (c) { this._children = this._children.filter(x => x !== c); },
            contains: function (c) { return this._children.includes(c); },
        });

        settings = makeSettings();
        zoneManager = makeZoneManager();
        animations = makeAnimations();
    });

    describe("show", () => {
        it("does not show when snapAssistEnabled=false", () => {
            settings.snapAssistEnabled = false;
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assert.equal(assist._overlays.length, 0);
        });

        it("does not show when no unsnapped windows", () => {
            windowTracker = makeWindowTracker([]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assert.equal(assist._overlays.length, 0);
        });

        it("creates one overlay per remaining zone", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zones = [
                { rect: new Rect(960, 0, 960, 540), zoneIndex: 1 },
                { rect: new Rect(960, 540, 960, 540), zoneIndex: 2 },
            ];
            assist.show("quarters", 0, 0, zones);
            assert.equal(assist._overlays.length, 2);
        });

        it("adds overlays to Main.uiGroup", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assert.ok(Main.uiGroup._children.length >= 1);
        });

        it("starts dismiss timer", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assert.notEqual(assist._dismissTimerId, null);
        });

        it("closes overlays when an UNOFFERED window gains focus (after arming)", () => {
            windowTracker = makeWindowTracker([makeWindow(1)]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assert.equal(assist._overlays.length, 1);

            // Simulate the arming grace period having elapsed.
            assist._armedUntil = 0;

            // Focusing a window that ISN'T one of the offered thumbnails (id 99)
            // means the user moved on → dismiss the previews.
            global.display._setFocusWindow({ get_id: () => 99 });
            global.display._emit("notify::focus-window");
            assert.equal(assist._overlays.length, 0);
        });

        it("keeps overlays when the just-snapped window settles focus (arming)", () => {
            windowTracker = makeWindowTracker([makeWindow(1)]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);

            // During arming, a focus event must NOT tear the previews down —
            // this is the "selectors vanish before you can click" regression.
            global.display._setFocusWindow({ get_id: () => 42 });
            global.display._emit("notify::focus-window");
            assert.equal(assist._overlays.length, 1);
        });
    });

    describe("overlay sizing", () => {
        it("does not shrink the picker down to a tiny zone's own size", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            // A "sixths"-sized zone — much smaller than a comfortable picker.
            const zone = { rect: new Rect(100, 100, 120, 90), zoneIndex: 1 };
            assist.show("sixths", 0, 0, [zone]);

            const overlay = assist._overlays[0];
            assert.ok(overlay.width >= 120, `overlay should stay usable-sized, got width=${overlay.width}`);
            assert.ok(overlay.height >= 90, `overlay should stay usable-sized, got height=${overlay.height}`);
        });

        it("keeps the overlay within the monitor bounds even anchored at a screen edge", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            // Zone hugging the top-left corner of a 1920x1080 monitor (default stub).
            const zone = { rect: new Rect(0, 0, 100, 80), zoneIndex: 0 };
            assist.show("sixths", 0, 0, [zone]);

            const overlay = assist._overlays[0];
            assert.ok(overlay.x >= 0, `overlay should not run off the left edge, got x=${overlay.x}`);
            assert.ok(overlay.y >= 0, `overlay should not run off the top edge, got y=${overlay.y}`);
        });
    });

    describe("destroyAll", () => {
        it("clears all overlays", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assist.destroyAll();
            assert.equal(assist._overlays.length, 0);
        });

        it("stops dismiss timer", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assist.destroyAll();
            assert.equal(assist._dismissTimerId, null);
        });

        it("safe to call when no overlays exist", () => {
            assist = new SnapAssist(settings, makeWindowTracker(), zoneManager, animations, makeLogger());
            assert.doesNotThrow(() => assist.destroyAll());
        });
    });

    describe("_onThumbnailClicked", () => {
        it("snaps window to target zone", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const win = makeWindow(5);
            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist._onThumbnailClicked(win, "halves", 0, 0, zone);

            assert.equal(windowTracker._calls.length, 1);
            assert.equal(windowTracker._calls[0][0], "snapWindow");
            assert.equal(windowTracker._calls[0][1], win);
            assert.equal(windowTracker._calls[0][2], "halves");
            assert.equal(windowTracker._calls[0][3], 1);        // zoneIndex
        });

        it("destroys all overlays after snapping", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assist._onThumbnailClicked(makeWindow(), "halves", 0, 0, zone);
            assert.equal(assist._overlays.length, 0);
        });
    });

    describe("dismiss timer", () => {
        it("_stopDismissTimer clears timer id", () => {
            assist = new SnapAssist(settings, makeWindowTracker(), zoneManager, animations, makeLogger());
            assist._dismissTimerId = 123;
            assist._stopDismissTimer();
            assert.equal(assist._dismissTimerId, null);
        });

        it("_resetDismissTimer creates new timer", () => {
            assist = new SnapAssist(settings, makeWindowTracker(), zoneManager, animations, makeLogger());
            assist._resetDismissTimer();
            assert.notEqual(assist._dismissTimerId, null);
        });
    });

    describe("destroy", () => {
        it("calls destroyAll", () => {
            windowTracker = makeWindowTracker([makeWindow()]);
            assist = new SnapAssist(settings, windowTracker, zoneManager, animations, makeLogger());

            const zone = { rect: new Rect(960, 0, 960, 1080), zoneIndex: 1 };
            assist.show("halves", 0, 0, [zone]);
            assist.destroy();
            assert.equal(assist._overlays.length, 0);
        });
    });
});
