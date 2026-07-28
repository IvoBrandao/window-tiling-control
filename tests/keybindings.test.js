/**
 * tests/keybindings.test.js
 *
 * Tests for src/keybindings.js — registration, handler dispatch,
 * enable/disable lifecycle, and error resilience.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Keybindings } from "../src/keybindings.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings() {
    return { kbSettings: { _schema: "org.gnome.shell.extensions.window-tiling-control.keybindings" } };
}

function makeLogger() {
    const logs = [];
    return {
        info: (...a) => logs.push(["info", ...a]),
        warn: (...a) => logs.push(["warn", ...a]),
        debug: (...a) => logs.push(["debug", ...a]),
        error: (...a) => logs.push(["error", ...a]),
        _logs: logs,
    };
}

function makeController() {
    const calls = [];
    return {
        snapFocusedToPreset: (preset, zone) => calls.push(["snapFocusedToPreset", preset, zone]),
        snapFocusedLeft: () => calls.push(["snapFocusedLeft"]),
        snapFocusedRight: () => calls.push(["snapFocusedRight"]),
        snapFocusedToUpperQuarter: () => calls.push(["snapFocusedToUpperQuarter"]),
        snapFocusedToLowerQuarter: () => calls.push(["snapFocusedToLowerQuarter"]),
        toggleSnapOverlay: () => calls.push(["toggleSnapOverlay"]),
        openZoneEditor: () => calls.push(["openZoneEditor"]),
        moveFocusedToMonitor: (dir) => calls.push(["moveFocusedToMonitor", dir]),
        moveSwapFocused: (dir) => calls.push(["moveSwapFocused", dir]),
        cyclePreset: (dir) => calls.push(["cyclePreset", dir]),
        restoreLastSnapGroup: () => calls.push(["restoreLastSnapGroup"]),
        focusCycleTiled: () => calls.push(["focusCycleTiled"]),
        autoTileToGrid: () => calls.push(["autoTileToGrid"]),
        _calls: calls,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Keybindings", () => {
    let addedBindings, removedBindings;

    beforeEach(() => {
        addedBindings = [];
        removedBindings = [];
        // Replace Main.wm with tracking mock
        globalThis.__wtcMainSet__("wm", {
            addKeybinding: (name, settings, flags, mode, handler) => {
                addedBindings.push({ name, settings, flags, mode, handler });
            },
            removeKeybinding: (name) => {
                removedBindings.push(name);
            },
        });
    });

    it("registers all 33 keybindings on enable", () => {
        const kb = new Keybindings(makeSettings(), makeController(), makeLogger());
        kb.enable();

        assert.equal(addedBindings.length, 33);
        assert.equal(kb._registered.length, 33);
    });

    it("registers expected binding names", () => {
        const kb = new Keybindings(makeSettings(), makeController(), makeLogger());
        kb.enable();

        const names = addedBindings.map(b => b.name);
        assert.ok(names.includes("snap-left-half"));
        assert.ok(names.includes("snap-right-half"));
        assert.ok(names.includes("snap-upper-quarter"));
        assert.ok(names.includes("snap-lower-quarter"));
        assert.ok(names.includes("snap-top-left"));
        assert.ok(names.includes("snap-top-right"));
        assert.ok(names.includes("snap-bottom-left"));
        assert.ok(names.includes("snap-bottom-right"));
        assert.ok(names.includes("open-snap-overlay"));
        assert.ok(names.includes("open-zone-editor"));
        assert.ok(names.includes("move-monitor-left"));
        assert.ok(names.includes("move-monitor-right"));
        assert.ok(names.includes("move-swap-left"));
        assert.ok(names.includes("move-swap-right"));
        assert.ok(names.includes("move-swap-up"));
        assert.ok(names.includes("move-swap-down"));
        assert.ok(names.includes("cycle-preset-next"));
        assert.ok(names.includes("cycle-preset-prev"));
        assert.ok(names.includes("restore-snap-group"));
        assert.ok(names.includes("focus-cycle-tiled"));
        assert.ok(names.includes("auto-tile-grid"));
    });

    it("all handlers are callable functions", () => {
        const kb = new Keybindings(makeSettings(), makeController(), makeLogger());
        kb.enable();

        for (const binding of addedBindings) {
            assert.equal(typeof binding.handler, "function");
        }
    });

    it("snap-left-half handler calls controller.snapFocusedLeft()", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-left-half");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedLeft"]);
    });

    it("snap-right-half handler calls controller.snapFocusedRight()", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-right-half");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedRight"]);
    });

    it("snap-top-left handler calls controller.snapFocusedToPreset('quarters', 0)", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-top-left");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedToPreset", "quarters", 0]);
    });

    it("snap-top-right handler calls controller.snapFocusedToPreset('quarters', 1)", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-top-right");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedToPreset", "quarters", 1]);
    });

    it("snap-bottom-left handler calls controller.snapFocusedToPreset('quarters', 2)", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-bottom-left");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedToPreset", "quarters", 2]);
    });

    it("snap-bottom-right handler calls controller.snapFocusedToPreset('quarters', 3)", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "snap-bottom-right");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["snapFocusedToPreset", "quarters", 3]);
    });

    it("open-snap-overlay handler calls controller.toggleSnapOverlay()", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "open-snap-overlay");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["toggleSnapOverlay"]);
    });

    it("move-swap-left handler calls controller.moveSwapFocused('left')", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "move-swap-left");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["moveSwapFocused", "left"]);
    });

    it("cycle-preset-next handler calls controller.cyclePreset(1)", () => {
        const ctrl = makeController();
        const kb = new Keybindings(makeSettings(), ctrl, makeLogger());
        kb.enable();

        const binding = addedBindings.find(b => b.name === "cycle-preset-next");
        binding.handler();
        assert.deepEqual(ctrl._calls[0], ["cyclePreset", 1]);
    });

    it("disable removes all registered keybindings", () => {
        const kb = new Keybindings(makeSettings(), makeController(), makeLogger());
        kb.enable();
        kb.disable();

        assert.equal(removedBindings.length, 33);
        assert.equal(kb._registered.length, 0);
    });

    it("disable can be called twice safely", () => {
        const kb = new Keybindings(makeSettings(), makeController(), makeLogger());
        kb.enable();
        kb.disable();
        assert.doesNotThrow(() => kb.disable());
        assert.equal(removedBindings.length, 33); // only first disable removes
    });

    it("survives addKeybinding failure for individual bindings", () => {
        let failCount = 0;
        globalThis.__wtcMainSet__("wm", {
            addKeybinding: (name, ...args) => {
                if (name === "snap-top-left") {
                    failCount++;
                    throw new Error("Binding conflict");
                }
                addedBindings.push({ name });
            },
            removeKeybinding: (name) => removedBindings.push(name),
        });

        const logger = makeLogger();
        const kb = new Keybindings(makeSettings(), makeController(), logger);
        kb.enable();

        assert.equal(failCount, 1);
        assert.equal(kb._registered.length, 32); // one failed
        assert.ok(logger._logs.some(l => l[0] === "warn" && l[1].includes("snap-top-left")));
    });

    it("passes kbSettings to addKeybinding", () => {
        const settings = makeSettings();
        const kb = new Keybindings(settings, makeController(), makeLogger());
        kb.enable();

        for (const binding of addedBindings) {
            assert.equal(binding.settings, settings.kbSettings);
        }
    });
});
