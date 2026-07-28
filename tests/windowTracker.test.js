/**
 * tests/windowTracker.test.js
 *
 * Tests for src/windowTracker.js — snap/unsnap lifecycle, group tracking,
 * propagateResize, and getUnsnappedWindows using in-memory stubs.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { WindowTracker } from "../src/windowTracker.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return { snapAssistEnabled: false, windowGapSize: 0, ...overrides };
}

function makeZoneManager(rects = []) {
    return {
        getZoneRects: () => rects,
        assignWindowToZone: () => {},
    };
}

let _nextId = 1;
function makeWindow({ monitorIndex = 0, workspaceIndex = 0, minimized = false } = {}) {
    const id = _nextId++;
    const frameRect = new Rect(0, 0, 960, 1080);
    const handlers = new Map();

    return {
        get_id: () => id,
        get_monitor: () => monitorIndex,
        get_workspace: () => ({ index: () => workspaceIndex }),
        get_frame_rect: () => frameRect,
        get_maximized: () => 0,
        move_resize_frame: (_userAction, x, y, w, h) => {
            frameRect.x = x; frameRect.y = y;
            frameRect.width = w; frameRect.height = h;
        },
        move_to_monitor: () => {},
        allows_resize: () => true,
        allows_move: () => true,
        minimized,
        skip_taskbar: false,
        unmaximize: () => {},
        connect: (sig, cb) => {
            if (!handlers.has(sig)) handlers.set(sig, []);
            const sid = Symbol(sig);
            handlers.get(sig).push({ sid, cb });
            return sid;
        },
        disconnect: () => {},
        _emit: (sig, ...args) => {
            for (const { cb } of handlers.get(sig) ?? []) cb(...args);
        },
    };
}

function makeTracker(settings, zoneManager) {
    const { display, workspace_manager } = setupGnomeGlobals();

    // Populate workspace_manager with a writable window list
    const allWindows = [];
    workspace_manager.get_workspace_by_index = (i) => ({
        index: () => i,
        list_windows: () => allWindows.filter(w => w.get_workspace().index() === i),
    });
    workspace_manager.get_n_workspaces = () => 2;

    const tracker = new WindowTracker(settings, zoneManager, null, null);
    return { tracker, allWindows, display, workspace_manager };
}

// Register windows so _getAllWindows() finds them
function register(allWindows, ...wins) {
    for (const w of wins) allWindows.push(w);
}

const ZONE_RECT_LEFT  = new Rect(0, 0, 960, 1080);
const ZONE_RECT_RIGHT = new Rect(960, 0, 960, 1080);

// ── snapWindow / getSnapEntry / unsnapWindow ──────────────────────────────────

describe("WindowTracker — snap/unsnap", () => {
    let tracker, allWindows;

    beforeEach(() => {
        ({ tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager()));
    });

    it("snapWindow records a snap entry", () => {
        const win = makeWindow();
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        const entry = tracker.getSnapEntry(win);
        assert.ok(entry, "entry should exist");
        assert.equal(entry.presetId, "halves");
        assert.equal(entry.zoneIndex, 0);
    });

    it("getSnapEntry returns null for untracked window", () => {
        const win = makeWindow();
        assert.equal(tracker.getSnapEntry(win), null);
    });

    it("unsnapWindow removes the entry", () => {
        const win = makeWindow();
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        tracker.unsnapWindow(win);
        assert.equal(tracker.getSnapEntry(win), null);
    });

    it("unsnapWindow is a no-op for untracked window", () => {
        const win = makeWindow();
        assert.doesNotThrow(() => tracker.unsnapWindow(win));
    });
});

// ── getSnapGroup ──────────────────────────────────────────────────────────────

describe("WindowTracker — getSnapGroup", () => {
    let tracker, allWindows;

    beforeEach(() => {
        ({ tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager()));
    });

    it("returns [] for an unsnapped window", () => {
        const win = makeWindow();
        assert.deepEqual(tracker.getSnapGroup(win), []);
    });

    it("returns just the window itself if no others share the preset+monitor+ws", () => {
        const win = makeWindow();
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        const group = tracker.getSnapGroup(win);
        assert.equal(group.length, 1);
        assert.strictEqual(group[0].metaWindow, win);
    });

    it("groups two windows snapped to the same preset on the same monitor", () => {
        const winA = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        const winB = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, winA, winB);
        tracker.snapWindow(winA, "halves", 0, ZONE_RECT_LEFT,  false);
        tracker.snapWindow(winB, "halves", 1, ZONE_RECT_RIGHT, false);
        const group = tracker.getSnapGroup(winA);
        assert.equal(group.length, 2);
    });

    it("does NOT group windows on different monitors", () => {
        const winA = makeWindow({ monitorIndex: 0 });
        const winB = makeWindow({ monitorIndex: 1 });
        register(allWindows, winA, winB);
        tracker.snapWindow(winA, "halves", 0, ZONE_RECT_LEFT,  false);
        tracker.snapWindow(winB, "halves", 1, ZONE_RECT_RIGHT, false);
        const group = tracker.getSnapGroup(winA);
        assert.equal(group.length, 1);
    });

    it("does NOT group windows on different workspaces", () => {
        const winA = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        const winB = makeWindow({ monitorIndex: 0, workspaceIndex: 1 });
        register(allWindows, winA, winB);
        tracker.snapWindow(winA, "halves", 0, ZONE_RECT_LEFT,  false);
        tracker.snapWindow(winB, "halves", 1, ZONE_RECT_RIGHT, false);
        const group = tracker.getSnapGroup(winA);
        assert.equal(group.length, 1);
    });
});

// ── getActiveSnapGroups ───────────────────────────────────────────────────────

describe("WindowTracker — getActiveSnapGroups", () => {
    let tracker, allWindows, workspace_manager;

    beforeEach(() => {
        ({ tracker, allWindows, workspace_manager } =
            makeTracker(makeSettings(), makeZoneManager()));
    });

    it("returns empty Map when no windows are snapped", () => {
        const groups = tracker.getActiveSnapGroups();
        assert.equal(groups.size, 0);
    });

    it("does NOT include single-window groups (size < 2)", () => {
        const win = makeWindow();
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        const groups = tracker.getActiveSnapGroups();
        assert.equal(groups.size, 0);
    });

    it("includes groups with ≥ 2 windows on the active workspace", () => {
        workspace_manager._setActiveWorkspace(0);
        const winA = makeWindow({ workspaceIndex: 0 });
        const winB = makeWindow({ workspaceIndex: 0 });
        register(allWindows, winA, winB);
        tracker.snapWindow(winA, "halves", 0, ZONE_RECT_LEFT,  false);
        tracker.snapWindow(winB, "halves", 1, ZONE_RECT_RIGHT, false);
        const groups = tracker.getActiveSnapGroups();
        assert.equal(groups.size, 1);
        const [group] = groups.values();
        assert.equal(group.members.length, 2);
    });
});

// ── getUnsnappedWindows ───────────────────────────────────────────────────────

describe("WindowTracker — getUnsnappedWindows", () => {
    let tracker, allWindows;

    beforeEach(() => {
        ({ tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager()));
    });

    it("returns all windows when none are snapped", () => {
        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, win);
        const unsnapped = tracker.getUnsnappedWindows(0, 0);
        assert.equal(unsnapped.length, 1);
    });

    it("excludes snapped windows", () => {
        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        const unsnapped = tracker.getUnsnappedWindows(0, 0);
        assert.equal(unsnapped.length, 0);
    });

    it("excludes minimized windows", () => {
        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0, minimized: true });
        register(allWindows, win);
        const unsnapped = tracker.getUnsnappedWindows(0, 0);
        assert.equal(unsnapped.length, 0);
    });

    it("returns only windows on the specified monitor+workspace", () => {
        const winRight = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        const winOther = makeWindow({ monitorIndex: 1, workspaceIndex: 0 });
        register(allWindows, winRight, winOther);
        const unsnapped = tracker.getUnsnappedWindows(0, 0);
        assert.equal(unsnapped.length, 1);
        assert.strictEqual(unsnapped[0], winRight);
    });
});

// ── getTileableWindows ────────────────────────────────────────────────────────

describe("WindowTracker — getTileableWindows", () => {
    let tracker, allWindows;

    beforeEach(() => {
        ({ tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager()));
    });

    it("includes already-snapped windows (unlike getUnsnappedWindows)", () => {
        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, ZONE_RECT_LEFT, false);
        assert.equal(tracker.getTileableWindows(0, 0).length, 1);
        assert.equal(tracker.getUnsnappedWindows(0, 0).length, 0);
    });

    it("excludes minimized windows", () => {
        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0, minimized: true });
        register(allWindows, win);
        assert.equal(tracker.getTileableWindows(0, 0).length, 0);
    });

    it("filters to the specified monitor+workspace", () => {
        const a = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        const b = makeWindow({ monitorIndex: 1, workspaceIndex: 0 });
        register(allWindows, a, b);
        const tileable = tracker.getTileableWindows(0, 0);
        assert.equal(tileable.length, 1);
        assert.strictEqual(tileable[0], a);
    });
});

// ── _onWindowMoved (drift detection) ─────────────────────────────────────────

describe("WindowTracker — drift unsnap", () => {
    it("unsnaps the window when it moves more than 30px away from zone", () => {
        const { tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager());

        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, new Rect(0, 0, 960, 1080), false);

        // Simulate the window moving far away
        win.move_resize_frame(false, 500, 500, 960, 1080);

        // Call _onWindowMoved directly (the signal is not wired in unit test)
        tracker._onWindowMoved(win);

        assert.equal(tracker.getSnapEntry(win), null);
    });

    it("keeps snap entry when window stays within 30px tolerance", () => {
        const { tracker, allWindows } = makeTracker(makeSettings(), makeZoneManager());

        const win = makeWindow({ monitorIndex: 0, workspaceIndex: 0 });
        register(allWindows, win);
        tracker.snapWindow(win, "halves", 0, new Rect(0, 0, 960, 1080), false);

        // Move only 5px — within tolerance
        win.move_resize_frame(false, 5, 0, 960, 1080);
        tracker._onWindowMoved(win);

        assert.ok(tracker.getSnapEntry(win), "entry should still exist");
    });
});

describe("WindowTracker persist (opt-in)", () => {
    beforeEach(() => setupGnomeGlobals());

    function persistSettings() {
        let store = [];
        return {
            snapAssistEnabled: false,
            windowGapSize: 0,
            persistSnapGroups: true,
            get snapGroupMemory() { return store; },
            set snapGroupMemory(v) { store = v; },
        };
    }

    it("serializes and reloads app placements", () => {
        const settings = persistSettings();
        const wt = new WindowTracker(settings, makeZoneManager(), null, null);

        wt._persistMemory.set("org.example.App.desktop", { presetId: "halves", zoneIndex: 1, monitorIndex: 0 });
        wt._savePersist();
        assert.deepEqual(settings.snapGroupMemory, ["org.example.App.desktop|halves|1|0"]);

        wt._persistMemory.clear();
        wt._loadPersist();
        const p = wt._persistMemory.get("org.example.App.desktop");
        assert.equal(p.presetId, "halves");
        assert.equal(p.zoneIndex, 1);
        assert.equal(p.monitorIndex, 0);
    });

    it("does not load anything when persistence is disabled", () => {
        const settings = persistSettings();
        settings.persistSnapGroups = false;
        settings.snapGroupMemory = ["org.example.App.desktop|halves|1|0"];
        const wt = new WindowTracker(settings, makeZoneManager(), null, null);
        wt._loadPersist();
        assert.equal(wt._persistMemory.size, 0);
    });
});
