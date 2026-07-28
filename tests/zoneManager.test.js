/**
 * tests/zoneManager.test.js
 *
 * Tests for src/zoneManager.js — exercises _normToPixel, getZoneRects,
 * getHoveredZone, findClosestZoneIndex, and getMonitorForPoint with a
 * stubbed global.display.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { ZoneManager } from "../src/zoneManager.js";
import { PRESETS } from "../src/layoutPresets.js";

// ── shared setup ──────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        windowGapSize: 0,
        dragEdgeThreshold: 20,
        ...overrides,
    };
}

function makeCustomZones(sets = []) {
    return {
        getAll: () => sets,
        getById: (id) => sets.find(s => s.id === id),
    };
}

const MONITOR_1920 = { x: 0, y: 0, width: 1920, height: 1080 };
const MONITOR_2560 = { x: 1920, y: 0, width: 2560, height: 1440 };

// ── _normToPixel via getZoneRects ─────────────────────────────────────────────

describe("ZoneManager.getZoneRects", () => {
    let zm;

    beforeEach(() => {
        const { display } = setupGnomeGlobals({ monitors: [MONITOR_1920] });
        // _getWorkarea used inside getZoneRects; stub get_focus_window
        display._setFocusWindow({
            get_work_area_for_monitor: (_i) => new Rect(0, 0, 1920, 1080),
        });
        zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
    });

    it("returns 2 rects for the halves preset", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects.length, 2);
    });

    it("halves left rect occupies the left half of 1920-wide monitor", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects[0].x, 0);
        assert.equal(rects[0].y, 0);
        assert.equal(rects[0].width, 960);
        assert.equal(rects[0].height, 1080);
    });

    it("halves right rect starts at x=960", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects[1].x, 960);
        assert.equal(rects[1].width, 960);
    });

    it("applies edge-aware gaps correctly", () => {
        // Inner gap 8 (outer follows inner). Left zone: screen-edge (outer=8) on
        // the left, shared edge (half inner=4) on the right → x=8, width=960-8-4=948.
        const zmGap = new ZoneManager(makeSettings({ windowGapSize: 8 }), makeCustomZones(), null);
        const rects = zmGap.getZoneRects("halves", 0);
        assert.equal(rects[0].x, 8);
        assert.equal(rects[0].width, 948);
        // The gap between the two halves is exactly the inner gap (8px).
        const rightStart = rects[1].x;
        const leftEnd = rects[0].x + rects[0].width;
        assert.equal(rightStart - leftEnd, 8);
    });

    it("outer gap is independently configurable", () => {
        const zmGap = new ZoneManager(
            makeSettings({ windowGapSize: 4, outerGapSize: 20 }), makeCustomZones(), null);
        const rects = zmGap.getZoneRects("halves", 0);
        // Left zone screen edge uses the outer gap (20), shared edge half inner (2).
        assert.equal(rects[0].x, 20);
        assert.equal(rects[0].width, 960 - 20 - 2);
    });

    it("returns 4 rects for quarters preset", () => {
        const rects = zm.getZoneRects("quarters", 0);
        assert.equal(rects.length, 4);
    });

    it("quarters top-left rect is in the top-left quadrant", () => {
        const rects = zm.getZoneRects("quarters", 0);
        assert.equal(rects[0].x, 0);
        assert.equal(rects[0].y, 0);
        assert.equal(rects[0].width, 960);
        assert.equal(rects[0].height, 540);
    });

    it("returns [] for unknown preset", () => {
        const rects = zm.getZoneRects("no-such-preset", 0);
        assert.deepEqual(rects, []);
    });

    it("memoizes: repeated calls return the same cached array", () => {
        const a = zm.getZoneRects("halves", 0);
        const b = zm.getZoneRects("halves", 0);
        assert.strictEqual(a, b);
    });

    it("invalidateCache forces a fresh computation", () => {
        const a = zm.getZoneRects("halves", 0);
        zm.invalidateCache();
        const b = zm.getZoneRects("halves", 0);
        assert.notStrictEqual(a, b);
        assert.deepEqual(a, b);
    });

    it("returns rects from a custom zone set", () => {
        const customSet = {
            id: "my-custom",
            label: "My Layout",
            zones: [
                { x: 0, y: 0, w: 0.3, h: 1 },
                { x: 0.3, y: 0, w: 0.7, h: 1 },
            ],
        };
        const zmCustom = new ZoneManager(makeSettings(), makeCustomZones([customSet]), null);
        const rects = zmCustom.getZoneRects("my-custom", 0);
        assert.equal(rects.length, 2);
        assert.equal(rects[0].width, Math.round(0.3 * 1920));
    });
});

// ── assignWindowToZone (placement / maximize race) ────────────────────────────

describe("ZoneManager.assignWindowToZone", () => {
    let zm;

    beforeEach(() => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
    });

    function makeWin(maximized = 0) {
        const calls = [];
        return {
            _moves: calls,
            get_maximized: () => maximized,
            unmaximize: () => calls.push(["unmaximize"]),
            get_compositor_private: () => ({}),
            move_resize_frame: (_u, x, y, w, h) => calls.push(["move", x, y, w, h]),
        };
    }

    it("moves a non-maximized window exactly once, synchronously", () => {
        const win = makeWin(0);
        zm.assignWindowToZone(win, new Rect(10, 20, 300, 400));
        assert.deepEqual(win._moves, [["move", 10, 20, 300, 400]]);
    });

    it("does not unmaximize a normal window", () => {
        const win = makeWin(0);
        zm.assignWindowToZone(win, new Rect(0, 0, 100, 100));
        assert.ok(!win._moves.some(c => c[0] === "unmaximize"));
    });

    it("unmaximizes a maximized window before (deferred) move", async () => {
        const win = makeWin(3 /* BOTH */);
        zm.assignWindowToZone(win, new Rect(5, 5, 200, 200));
        // Unmaximize is synchronous; the move is deferred to idle (microtask).
        assert.deepEqual(win._moves, [["unmaximize"]]);
        await Promise.resolve();
        assert.deepEqual(win._moves[1], ["move", 5, 5, 200, 200]);
    });

    it("does nothing when window is null", () => {
        assert.doesNotThrow(() => zm.assignWindowToZone(null, new Rect(0, 0, 1, 1)));
    });
});

// ── getHoveredZone ────────────────────────────────────────────────────────────

describe("ZoneManager.getHoveredZone", () => {
    let zm;

    beforeEach(() => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        global.display._setFocusWindow({
            get_work_area_for_monitor: () => new Rect(0, 0, 1920, 1080),
        });
        zm = new ZoneManager(makeSettings({ dragEdgeThreshold: 20 }), makeCustomZones(), null);
    });

    it("returns null when pointer is outside workarea", () => {
        const hit = zm.getHoveredZone(-100, -100, "halves", 0);
        assert.equal(hit, null);
    });

    it("returns left zone when pointer is in left half", () => {
        const hit = zm.getHoveredZone(480, 540, "halves", 0);
        assert.ok(hit, "should hit a zone");
        assert.equal(hit.zoneIndex, 0);
    });

    it("returns right zone when pointer is in right half", () => {
        const hit = zm.getHoveredZone(1440, 540, "halves", 0);
        assert.ok(hit, "should hit a zone");
        assert.equal(hit.zoneIndex, 1);
    });

    it("returns null for unknown preset", () => {
        const hit = zm.getHoveredZone(100, 100, "no-preset", 0);
        assert.equal(hit, null);
    });
});

// ── getMonitorForPoint ────────────────────────────────────────────────────────

describe("ZoneManager.getMonitorForPoint", () => {
    it("returns 0 for point in monitor 0", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920, MONITOR_2560] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        assert.equal(zm.getMonitorForPoint(100, 100), 0);
    });

    it("returns 1 for point in monitor 1 (offset at x=1920)", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920, MONITOR_2560] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        assert.equal(zm.getMonitorForPoint(2000, 100), 1);
    });

    it("returns current monitor for a point outside all monitors", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        // Falls back to get_current_monitor() which is 0
        assert.equal(zm.getMonitorForPoint(99999, 99999), 0);
    });
});

// ── findClosestZoneIndex ──────────────────────────────────────────────────────

describe("ZoneManager.findClosestZoneIndex", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        global.display._setFocusWindow({
            get_work_area_for_monitor: () => new Rect(0, 0, 1920, 1080),
        });
    });

    it("returns 0 for a rect that aligns with the left zone of halves", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const leftRect = new Rect(0, 0, 960, 1080);
        assert.equal(zm.findClosestZoneIndex(leftRect, "halves", 0), 0);
    });

    it("returns 1 for a rect that aligns with the right zone of halves", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const rightRect = new Rect(960, 0, 960, 1080);
        assert.equal(zm.findClosestZoneIndex(rightRect, "halves", 0), 1);
    });

    it("returns 0 as fallback for empty preset", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const rect = new Rect(0, 0, 100, 100);
        assert.equal(zm.findClosestZoneIndex(rect, "nonexistent", 0), 0);
    });
});
