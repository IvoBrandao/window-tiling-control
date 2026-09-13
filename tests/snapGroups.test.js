/**
 * tests/snapGroups.test.js
 *
 * Tests for src/snapGroups.js — group restore, panel button visibility,
 * enable/disable lifecycle, and popup open/close.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { SnapGroupsManager } from "../src/snapGroups.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        snapGroupsEnabled: true,
        ...overrides,
    };
}

function makeWindowTracker(groups = new Map()) {
    return {
        getActiveSnapGroups: () => groups,
        _zoneManager: {
            assignWindowToZone: () => {},
        },
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
        activate: () => {},
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SnapGroupsManager", () => {
    let manager, settings, windowTracker, animations;

    beforeEach(() => {
        const { display } = setupGnomeGlobals();

        globalThis.__wtcMainSet__("uiGroup", {
            _children: [],
            add_child: function (c) { this._children.push(c); },
            remove_child: function (c) { this._children = this._children.filter(x => x !== c); },
            contains: function (c) { return this._children.includes(c); },
        });

        globalThis.__wtcMainSet__("panel", {
            _rightBox: {
                _children: [],
                insert_child_at_index: function (child, idx) { this._children.splice(idx, 0, child); },
                remove_child: function (c) { this._children = this._children.filter(x => x !== c); },
            },
        });

        settings = makeSettings();
        animations = makeAnimations();
    });

    describe("enable/disable", () => {
        it("does nothing when snapGroupsEnabled=false", () => {
            settings.snapGroupsEnabled = false;
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            assert.equal(manager._button, null);
        });

        it("creates panel button when enabled", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            assert.notEqual(manager._button, null);
        });

        it("disable destroys button", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            manager.disable();
            assert.equal(manager._button, null);
        });

        it("clears signal subscriptions on disable", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            assert.ok(manager._displaySignalIds.length > 0);
            manager.disable();
            assert.equal(manager._displaySignalIds.length, 0);
            assert.equal(manager._wmSignalIds.length, 0);
        });

        // Regression: enable() had no re-entrancy guard, so a second call
        // while already enabled (session-mode changes can re-invoke
        // enable/disable) built a second panel button — leaking the first
        // one, orphaned in Main.panel._rightBox — and duplicated every
        // display/workspace-manager signal connection.
        it("is idempotent: calling enable() twice does not create a second button or duplicate signals", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            const button1 = manager._button;
            const displayCount1 = manager._displaySignalIds.length;
            const wmCount1 = manager._wmSignalIds.length;
            const rightBoxChildren1 = Main.panel._rightBox._children.length;

            manager.enable();

            assert.equal(manager._button, button1, "must not build a second button");
            assert.equal(manager._displaySignalIds.length, displayCount1);
            assert.equal(manager._wmSignalIds.length, wmCount1);
            assert.equal(Main.panel._rightBox._children.length, rightBoxChildren1,
                "must not leak an orphaned button into the panel");
        });

        it("disable() then enable() again rebuilds cleanly", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            manager.disable();
            assert.doesNotThrow(() => manager.enable());
            assert.notEqual(manager._button, null);
        });
    });

    describe("_refreshButton", () => {
        it("shows button when groups exist", () => {
            const groups = new Map([
                ["halves:0:0", {
                    members: [
                        { metaWindow: makeWindow(1), entry: { zoneRect: new Rect(0, 0, 960, 1080) } },
                        { metaWindow: makeWindow(2), entry: { zoneRect: new Rect(960, 0, 960, 1080) } },
                    ],
                }],
            ]);
            windowTracker = makeWindowTracker(groups);
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();

            // _refreshButton is called by enable
            assert.equal(manager._button.visible, true);
        });

        it("hides button when no groups", () => {
            windowTracker = makeWindowTracker(new Map());
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            assert.equal(manager._button.visible, false);
        });
    });

    describe("restoreGroup", () => {
        it("calls assignWindowToZone for each group member", () => {
            const calls = [];
            const wt = makeWindowTracker(new Map([
                ["test-group", {
                    members: [
                        { metaWindow: makeWindow(1), entry: { zoneRect: new Rect(0, 0, 960, 1080) } },
                        { metaWindow: makeWindow(2), entry: { zoneRect: new Rect(960, 0, 960, 1080) } },
                    ],
                }],
            ]));
            wt._zoneManager.assignWindowToZone = (...args) => calls.push(args);

            manager = new SnapGroupsManager(settings, wt, animations, makeLogger());
            manager.enable();
            manager.restoreGroup("test-group");

            assert.equal(calls.length, 2);
        });

        it("does nothing for unknown group key", () => {
            windowTracker = makeWindowTracker(new Map());
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            assert.doesNotThrow(() => manager.restoreGroup("nonexistent"));
        });

        it("activates first window in group", () => {
            let activatedId = null;
            const win1 = makeWindow(1);
            win1.activate = () => { activatedId = 1; };
            const win2 = makeWindow(2);

            const wt = makeWindowTracker(new Map([
                ["test-group", {
                    members: [
                        { metaWindow: win1, entry: { zoneRect: new Rect(0, 0, 960, 1080) } },
                        { metaWindow: win2, entry: { zoneRect: new Rect(960, 0, 960, 1080) } },
                    ],
                }],
            ]));

            manager = new SnapGroupsManager(settings, wt, animations, makeLogger());
            manager.enable();
            manager.restoreGroup("test-group");
            assert.equal(activatedId, 1);
        });
    });

    describe("refresh", () => {
        it("delegates to _refreshButton", () => {
            windowTracker = makeWindowTracker();
            manager = new SnapGroupsManager(settings, windowTracker, animations, makeLogger());
            manager.enable();
            // Should not throw even with no groups
            assert.doesNotThrow(() => manager.refresh());
        });
    });
});
