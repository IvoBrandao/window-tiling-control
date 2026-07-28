/**
 * tests/directionalMove.test.js
 *
 * Tests for the pure i3-style directional movement model. Verifies both the
 * geometry classification and the full direction transition table, including
 * the user-reported case: top-right + Down → bottom-right.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifySlot, resolveMove, slotFromEntry, SLOT_MOVES, zoneIndexForRect, neighborZoneIndex } from "../src/directionalMove.js";

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

// Frame rects for each slot on a 1920×1080 workarea.
const FRAMES = {
    maxi: { x: 0,   y: 0,   width: 1920, height: 1080 },
    L:    { x: 0,   y: 0,   width: 960,  height: 1080 },
    R:    { x: 960, y: 0,   width: 960,  height: 1080 },
    TL:   { x: 0,   y: 0,   width: 960,  height: 540 },
    TR:   { x: 960, y: 0,   width: 960,  height: 540 },
    BL:   { x: 0,   y: 540, width: 960,  height: 540 },
    BR:   { x: 960, y: 540, width: 960,  height: 540 },
};

describe("classifySlot", () => {
    for (const [slot, frame] of Object.entries(FRAMES)) {
        it(`classifies ${slot} geometry as "${slot}"`, () => {
            assert.equal(classifySlot(frame, WA), slot);
        });
    }

    it("classifies a small floating window by its center", () => {
        // Small window in the bottom-right area → BR
        assert.equal(classifySlot({ x: 1400, y: 700, width: 300, height: 200 }, WA), "BR");
    });

    it("respects a non-zero workarea origin (multi-monitor)", () => {
        const wa = { x: 1920, y: 0, width: 1920, height: 1080 };
        const topRight = { x: 1920 + 960, y: 0, width: 960, height: 540 };
        assert.equal(classifySlot(topRight, wa), "TR");
    });
});

describe("resolveMove — user-reported case", () => {
    it("top-right + Down → bottom-right quarter", () => {
        assert.deepEqual(resolveMove("TR", "down"), ["quarters", 3]);
    });

    it("bottom-right + Up → top-right quarter (reverse)", () => {
        assert.deepEqual(resolveMove("BR", "up"), ["quarters", 1]);
    });
});

describe("resolveMove — horizontal navigation", () => {
    it("right half + Left → left half", () => {
        assert.deepEqual(resolveMove("R", "left"), ["halves", 0]);
    });
    it("left half + Right → right half", () => {
        assert.deepEqual(resolveMove("L", "right"), ["halves", 1]);
    });
    it("top-left + Right → top-right", () => {
        assert.deepEqual(resolveMove("TL", "right"), ["quarters", 1]);
    });
    it("top-right + Left → top-left", () => {
        assert.deepEqual(resolveMove("TR", "left"), ["quarters", 0]);
    });
});

describe("resolveMove — edges", () => {
    it("left half + Left is a no-op (outer edge)", () => {
        assert.equal(resolveMove("L", "left"), null);
    });
    it("right half + Right is a no-op (outer edge)", () => {
        assert.equal(resolveMove("R", "right"), null);
    });
    it("maximized + Up/Down are no-ops", () => {
        assert.equal(resolveMove("maxi", "up"), null);
        assert.equal(resolveMove("maxi", "down"), null);
    });
    it("top-left + Up grows to the left half", () => {
        assert.deepEqual(resolveMove("TL", "up"), ["halves", 0]);
    });
    it("bottom-right + Down grows to the right half", () => {
        assert.deepEqual(resolveMove("BR", "down"), ["halves", 1]);
    });
});

describe("resolveMove — half enters the grid vertically", () => {
    it("left half + Up → top-left quarter", () => {
        assert.deepEqual(resolveMove("L", "up"), ["quarters", 0]);
    });
    it("left half + Down → bottom-left quarter", () => {
        assert.deepEqual(resolveMove("R", "down"), ["quarters", 3]);
    });
    it("maximized + Left/Right → halves", () => {
        assert.deepEqual(resolveMove("maxi", "left"), ["halves", 0]);
        assert.deepEqual(resolveMove("maxi", "right"), ["halves", 1]);
    });
});

describe("slotFromEntry", () => {
    it("maps halves entries to L/R", () => {
        assert.equal(slotFromEntry({ presetId: "halves", zoneIndex: 0 }), "L");
        assert.equal(slotFromEntry({ presetId: "halves", zoneIndex: 1 }), "R");
    });
    it("maps quarters entries to corner slots", () => {
        assert.equal(slotFromEntry({ presetId: "quarters", zoneIndex: 0 }), "TL");
        assert.equal(slotFromEntry({ presetId: "quarters", zoneIndex: 1 }), "TR");
        assert.equal(slotFromEntry({ presetId: "quarters", zoneIndex: 2 }), "BL");
        assert.equal(slotFromEntry({ presetId: "quarters", zoneIndex: 3 }), "BR");
    });
    it("returns null for no entry or a non-built-in preset", () => {
        assert.equal(slotFromEntry(null), null);
        assert.equal(slotFromEntry(undefined), null);
        assert.equal(slotFromEntry({ presetId: "custom-xyz", zoneIndex: 0 }), null);
    });
    it("enables exact movement for a size-quirky app (Ghostty/Nautilus)", () => {
        // A tracked top-right window whose real geometry drifted — the entry is
        // authoritative, so Down still resolves to bottom-right.
        const slot = slotFromEntry({ presetId: "quarters", zoneIndex: 1 });
        assert.deepEqual(resolveMove(slot, "down"), ["quarters", 3]);
    });
});

// ── Layout-aware navigation (the "half + 2 quarters" bug) ───────────────────

describe("neighborZoneIndex — half-quarters layout", () => {
    // half-quarters: [left full-height, right-top quarter, right-bottom quarter]
    const rects = [
        { x: 0,   y: 0,   width: 960, height: 1080 }, // 0: left half
        { x: 960, y: 0,   width: 960, height: 540  }, // 1: right top
        { x: 960, y: 540, width: 960, height: 540  }, // 2: right bottom
    ];

    it("left half → right yields right-top", () => {
        assert.equal(neighborZoneIndex(rects, 0, "right"), 1);
    });
    it("right-top → left yields left half", () => {
        assert.equal(neighborZoneIndex(rects, 1, "left"), 0);
    });
    it("right-top → down yields right-bottom", () => {
        assert.equal(neighborZoneIndex(rects, 1, "down"), 2);
    });
    it("right-bottom → up yields right-top", () => {
        assert.equal(neighborZoneIndex(rects, 2, "up"), 1);
    });
    it("left half → left is a no-op (outer edge)", () => {
        assert.equal(neighborZoneIndex(rects, 0, "left"), -1);
    });
    it("right-top → up is a no-op (no zone above, non-adjacent skipped)", () => {
        assert.equal(neighborZoneIndex(rects, 1, "up"), -1);
    });
});

describe("zoneIndexForRect", () => {
    const rects = [
        { x: 0,   y: 0, width: 960, height: 1080 },
        { x: 960, y: 0, width: 960, height: 1080 },
    ];
    it("matches the zone a window most overlaps", () => {
        assert.equal(zoneIndexForRect(rects, { x: 970, y: 10, width: 900, height: 1000 }), 1);
        assert.equal(zoneIndexForRect(rects, { x: 10, y: 10, width: 900, height: 1000 }), 0);
    });
});

describe("SLOT_MOVES completeness", () => {
    it("every slot defines all four directions", () => {
        for (const moves of Object.values(SLOT_MOVES)) {
            for (const dir of ["left", "right", "up", "down"]) {
                assert.ok(dir in moves, `missing ${dir}`);
            }
        }
    });
});
