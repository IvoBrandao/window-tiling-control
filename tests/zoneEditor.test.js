/**
 * tests/zoneEditor.test.js
 *
 * Tests for src/zoneEditor.js — grid snapping, zone CRUD,
 * deletion by object reference, status updates, and save logic.
 *
 * Uses a shim approach: extracts the pure-logic methods from ZoneEditor
 * without needing the full UI actor creation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals } from "./helpers/gnome-globals.js";

// ── ZoneEditor Logic Shim ─────────────────────────────────────────────────────
// We import ZoneEditor but test internal methods directly since the UI
// construction methods require full St/Clutter mocks. For open/close
// lifecycle we mock the necessary UI objects.

import { ZoneEditor } from "../src/zoneEditor.js";

function makeSettings(overrides = {}) {
    return {
        zoneEditorGridColumns: 12,
        zoneEditorGridRows: 8,
        windowGapSize: 0,
        ...overrides,
    };
}

function makeCustomZones(existing = []) {
    const store = [...existing];
    let nextId = 100;
    return {
        getAll: () => store,
        getById: (id) => store.find(s => s.id === id) ?? null,
        addZoneSet: (set) => store.push(set),
        updateZoneSet: (id, data) => {
            const s = store.find(x => x.id === id);
            if (s) Object.assign(s, data);
        },
        removeZoneSet: (id) => {
            const idx = store.findIndex(s => s.id === id);
            if (idx >= 0) store.splice(idx, 1);
        },
        generateId: () => `custom-${nextId++}`,
        connect: () => Symbol("changed"),
        _store: store,
    };
}

function makeZoneManager() {
    return {
        getZoneRects: () => [],
    };
}

function makeAnimations() {
    return {
        fadeIn: () => {},
        fadeOut: (_actor, _dur, cb) => cb?.(),
        slideIn: () => {},
    };
}

function makeLogger() {
    const logs = [];
    return {
        debug: (...a) => logs.push(["debug", ...a]),
        info: (...a) => logs.push(["info", ...a]),
        warn: (...a) => logs.push(["warn", ...a]),
        error: (...a) => logs.push(["error", ...a]),
        _logs: logs,
    };
}

// ── Grid Snap Tests ──────────────────────────────────────────────────────────

describe("ZoneEditor._snapToGrid", () => {
    let editor;

    beforeEach(() => {
        setupGnomeGlobals();
        editor = new ZoneEditor(
            makeSettings(), makeCustomZones(), makeZoneManager(),
            makeAnimations(), makeLogger()
        );
    });

    it("snaps x to nearest column division (12 columns)", () => {
        const result = editor._snapToGrid({ x: 0.33, y: 0, w: 0.5, h: 0.5 });
        // snap(0.33, 12) = Math.round(0.33 * 12) / 12 = Math.round(3.96) / 12 = 4/12 = 0.333...
        assert.ok(Math.abs(result.x - 1 / 3) < 0.001);
    });

    it("snaps y to nearest row division (8 rows)", () => {
        const result = editor._snapToGrid({ x: 0, y: 0.44, w: 0.5, h: 0.5 });
        // snap(0.44, 8) = Math.round(0.44 * 8) / 8 = Math.round(3.52) / 8 = 4/8 = 0.5
        assert.equal(result.y, 0.5);
    });

    it("enforces minimum width of 1/cols", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.01, h: 0.5 });
        // min width = 1/12 ≈ 0.0833
        assert.ok(Math.abs(result.w - 1 / 12) < 0.001);
    });

    it("enforces minimum height of 1/rows", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.5, h: 0.01 });
        // min height = 1/8 = 0.125
        assert.equal(result.h, 0.125);
    });

    it("snaps half-width correctly", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.5, h: 1 });
        // snap(0.5, 12) = Math.round(6) / 12 = 0.5
        assert.equal(result.w, 0.5);
    });

    it("snaps to full width and height", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 1.0, h: 1.0 });
        assert.equal(result.w, 1.0);
        assert.equal(result.h, 1.0);
    });

    it("uses custom grid dimensions from settings", () => {
        const editor6x4 = new ZoneEditor(
            makeSettings({ zoneEditorGridColumns: 6, zoneEditorGridRows: 4 }),
            makeCustomZones(), makeZoneManager(), makeAnimations(), makeLogger()
        );
        const result = editor6x4._snapToGrid({ x: 0.16, y: 0.24, w: 0.5, h: 0.5 });
        // snap(0.16, 6) = Math.round(0.96) / 6 = 1/6 ≈ 0.1667
        assert.ok(Math.abs(result.x - 1 / 6) < 0.001);
        // snap(0.24, 4) = Math.round(0.96) / 4 = 1/4 = 0.25
        assert.equal(result.y, 0.25);
    });

    // Regression: x and w (resp. y and h) are snapped independently, so a
    // rect drawn right up against the monitor edge could previously round to
    // x=1.0 with a nonzero minimum width, producing x+w > 1 — a zone that
    // extends past the right/bottom edge of the monitor.
    it("never lets a snapped zone's right edge extend past x=1", () => {
        const result = editor._snapToGrid({ x: 0.999, y: 0, w: 0.001, h: 0.5 });
        assert.ok(result.x + result.w <= 1 + 1e-9, `x+w = ${result.x + result.w}`);
    });

    it("never lets a snapped zone's bottom edge extend past y=1", () => {
        const result = editor._snapToGrid({ x: 0, y: 0.999, w: 0.5, h: 0.001 });
        assert.ok(result.y + result.h <= 1 + 1e-9, `y+h = ${result.y + result.h}`);
    });
});

// ── Handle-drag (resize) tests ───────────────────────────────────────────────

describe("ZoneEditor._applyHandleDrag", () => {
    let editor;
    const GEOM = { width: 1200, height: 800 };

    beforeEach(() => {
        setupGnomeGlobals();
        // Grid resolution matched 1:1 to GEOM's pixel dimensions so
        // _snapToGrid's rounding is exact for these whole-pixel test
        // fixtures and doesn't obscure the anchor-math being tested.
        editor = new ZoneEditor(
            makeSettings({ zoneEditorGridColumns: GEOM.width, zoneEditorGridRows: GEOM.height }),
            makeCustomZones(), makeZoneManager(), makeAnimations(), makeLogger()
        );
        editor._area = GEOM;
        editor._canvas = { add_child: () => {}, remove_child: () => {} };
    });

    function makeZoneEntry(normRect) {
        return {
            normRect,
            actor: { destroy: () => {}, set_position: () => {}, set_size: () => {} },
            handles: [{ destroy: () => {} }],
        };
    }

    it("dragging the right handle keeps the left edge anchored", () => {
        const zone = makeZoneEntry({ x: 0.25, y: 0, w: 0.5, h: 1 });
        editor._zones = [zone];
        editor._draggingHandle = {
            zone, edge: "r", startX: 600, startY: 0,
            origRect: { ...zone.normRect },
        };

        editor._applyHandleDrag(720, 0, GEOM); // drag right by 120px = 0.1 normalized

        assert.ok(Math.abs(zone.normRect.x - 0.25) < 1e-9, "left edge must not move");
        assert.ok(Math.abs(zone.normRect.w - 0.6) < 1e-9, `width = ${zone.normRect.w}`);
    });

    it("dragging the left handle keeps the right edge anchored, even overshooting past the monitor edge", () => {
        // Regression: naively clamping x to 0 without re-deriving w from the
        // fixed right edge used to make the right edge jump outward by the
        // overshoot amount instead of staying put.
        const zone = makeZoneEntry({ x: 0.05, y: 0, w: 0.2, h: 1 }); // right edge at x=0.25
        editor._zones = [zone];
        editor._draggingHandle = {
            zone, edge: "l", startX: 60, startY: 0,
            origRect: { ...zone.normRect },
        };

        // Drag left by 180px (0.15 normalized) — overshoots past the left
        // edge of the monitor (0.05 - 0.15 = -0.10).
        editor._applyHandleDrag(-120, 0, GEOM);

        assert.equal(zone.normRect.x, 0, "x must clamp to the monitor edge");
        const right = zone.normRect.x + zone.normRect.w;
        assert.ok(Math.abs(right - 0.25) < 1e-9,
            `right edge must stay anchored at 0.25, got ${right}`);
    });

    it("dragging the top handle keeps the bottom edge anchored past the monitor edge", () => {
        const zone = makeZoneEntry({ x: 0, y: 0.05, w: 1, h: 0.2 }); // bottom edge at y=0.25
        editor._zones = [zone];
        editor._draggingHandle = {
            zone, edge: "t", startX: 0, startY: 40,
            origRect: { ...zone.normRect },
        };

        editor._applyHandleDrag(0, -80, GEOM); // overshoot past the top edge

        assert.equal(zone.normRect.y, 0);
        const bottom = zone.normRect.y + zone.normRect.h;
        assert.ok(Math.abs(bottom - 0.25) < 1e-9,
            `bottom edge must stay anchored at 0.25, got ${bottom}`);
    });

    it("dragging the bottom-right corner grows both dimensions from the top-left anchor", () => {
        const zone = makeZoneEntry({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
        editor._zones = [zone];
        editor._draggingHandle = {
            zone, edge: "br", startX: 0, startY: 0,
            origRect: { ...zone.normRect },
        };

        editor._applyHandleDrag(120, 80, GEOM); // +0.1 width, +0.1 height

        assert.ok(Math.abs(zone.normRect.x - 0.1) < 1e-9);
        assert.ok(Math.abs(zone.normRect.y - 0.1) < 1e-9);
        assert.ok(Math.abs(zone.normRect.w - 0.4) < 1e-9);
        assert.ok(Math.abs(zone.normRect.h - 0.4) < 1e-9);
    });

    it("never shrinks a dimension below the minimum zone size", () => {
        const zone = makeZoneEntry({ x: 0.4, y: 0, w: 0.2, h: 1 }); // 240px wide
        editor._zones = [zone];
        editor._draggingHandle = {
            zone, edge: "r", startX: 0, startY: 0,
            origRect: { ...zone.normRect },
        };

        // Drag the right handle far to the left — well past collapsing to 0.
        editor._applyHandleDrag(-1000, 0, GEOM);

        const widthPx = zone.normRect.w * GEOM.width;
        assert.ok(widthPx >= 40 - 1e-6, `width in px = ${widthPx}, must stay >= MIN_ZONE_PX`);
    });
});

// ── Zone CRUD Tests ──────────────────────────────────────────────────────────

describe("ZoneEditor zone management", () => {
    let editor, customZones, logger;

    beforeEach(() => {
        setupGnomeGlobals();
        customZones = makeCustomZones();
        logger = makeLogger();
        editor = new ZoneEditor(
            makeSettings(), customZones, makeZoneManager(),
            makeAnimations(), logger
        );
        // Set up minimal canvas context for _addZoneActor to work
        editor._monitorIndex = 0;
        editor._canvas = {
            add_child: () => {},
            remove_child: () => {},
        };
        editor._statusLabel = { text: "" };
    });

    it("_addZoneActor adds zone to internal array", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(editor._zones.length, 1);
    });

    it("_addZoneActor creates 8 handles per zone", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(editor._zones[0].handles.length, 8);
    });

    it("_addZoneActor returns index of new zone", () => {
        const idx = editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(idx, 0);
        const idx2 = editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        assert.equal(idx2, 1);
    });

    it("_deleteZone removes zone by object reference", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0, y: 0.5, w: 0.5, h: 0.5 });

        const secondZone = editor._zones[1];
        editor._deleteZone(secondZone);

        assert.equal(editor._zones.length, 2);
        // First and third zone remain
        assert.equal(editor._zones[0].normRect.x, 0);
        assert.equal(editor._zones[1].normRect.x, 0); // was third, now second
        assert.equal(editor._zones[1].normRect.y, 0.5);
    });

    it("_deleteZone with stale reference does nothing", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        const zone = editor._zones[0];
        editor._deleteZone(zone);
        // Try again with stale reference
        assert.doesNotThrow(() => editor._deleteZone(zone));
        assert.equal(editor._zones.length, 0);
    });

    it("sequential deletions maintain correct references", () => {
        // This is the critical bug test: old code captured array indices
        // which became stale after splice. New code uses object references.
        editor._addZoneActor({ x: 0, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.25, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.75, y: 0, w: 0.25, h: 0.5 });

        // Save references before any deletion
        const zone0 = editor._zones[0];
        const zone2 = editor._zones[2];

        // Delete zone at index 0
        editor._deleteZone(zone0);
        assert.equal(editor._zones.length, 3);

        // zone2 reference still valid, even though indices shifted
        editor._deleteZone(zone2);
        assert.equal(editor._zones.length, 2);

        // Remaining zones should be index 1 and 3 from original
        assert.equal(editor._zones[0].normRect.x, 0.25);
        assert.equal(editor._zones[1].normRect.x, 0.75);
    });

    it("_resetZones clears all zones", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        editor._resetZones();
        assert.equal(editor._zones.length, 0);
    });

    it("_updateStatus shows zone count text", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.ok(editor._statusLabel.text.includes("1"));

        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        assert.ok(editor._statusLabel.text.includes("2"));
    });
});

// ── Save Tests ───────────────────────────────────────────────────────────────

describe("ZoneEditor._saveZones", () => {
    let editor, customZones, logger;

    beforeEach(() => {
        setupGnomeGlobals();
        customZones = makeCustomZones();
        logger = makeLogger();
        editor = new ZoneEditor(
            makeSettings(), customZones, makeZoneManager(),
            makeAnimations(), logger
        );
        editor._monitorIndex = 0;
        editor._canvas = { add_child: () => {}, remove_child: () => {} };
        editor._statusLabel = { text: "" };
        editor._nameEntry = { get_text: () => "My Layout" };
        // Prevent close() from accessing null backdrop
        editor._backdrop = null;
    });

    it("saves new zone set with correct data", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 1 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 1 });
        editor._saveZones();

        assert.equal(customZones._store.length, 1);
        assert.equal(customZones._store[0].label, "My Layout");
        assert.equal(customZones._store[0].zones.length, 2);
    });

    it("does not save with 0 zones", () => {
        editor._saveZones();
        assert.equal(customZones._store.length, 0);
        assert.ok(logger._logs.some(l => l[0] === "warn"));
    });

    it("updates existing zone set when editing", () => {
        customZones.addZoneSet({ id: "existing-1", label: "Old", zones: [{ x: 0, y: 0, w: 1, h: 1 }] });
        editor._editingSetId = "existing-1";

        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 1 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 1 });
        editor._saveZones();

        assert.equal(customZones._store.length, 1);
        assert.equal(customZones._store[0].label, "My Layout");
        assert.equal(customZones._store[0].zones.length, 2);
    });

    it("generates default name when entry is empty", () => {
        editor._nameEntry = { get_text: () => "" };
        editor._addZoneActor({ x: 0, y: 0, w: 1, h: 1 });
        editor._saveZones();

        assert.ok(customZones._store[0].label.length > 0);
    });
});
