/**
 * tests/roundedCorners.test.js
 *
 * Tests for src/roundedCorners.js. No test file previously existed for this
 * module; the gi:// mock lacked Meta.WindowType and Clutter.ShaderEffect, so
 * these paths (including a real signal-leak bug found during review) were
 * completely unexercised.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals } from "./helpers/gnome-globals.js";
import Meta from "gi://Meta";
import { RoundedCorners } from "../src/roundedCorners.js";

function makeSettings(overrides = {}) {
    const handlers = new Map();
    return {
        roundedCornersEnabled: true,
        roundedCornersRadius: 12,
        connect(signal, cb) {
            if (!handlers.has(signal)) handlers.set(signal, []);
            const id = Symbol(signal);
            handlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect(id) {
            for (const [sig, cbs] of handlers)
                handlers.set(sig, cbs.filter(h => h.id !== id));
        },
        _emit(signal) {
            for (const { cb } of handlers.get(signal) ?? []) cb();
        },
        ...overrides,
    };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

/** A fake Clutter actor good enough for add_effect_with_name/get_effect/remove_effect. */
function makeActor(metaWindow) {
    const effects = new Map();
    const destroyHandlers = [];
    return {
        meta_window: metaWindow,
        add_effect_with_name(name, effect) { effects.set(name, effect); },
        get_effect(name) { return effects.get(name) ?? null; },
        remove_effect(effect) {
            for (const [k, v] of effects) if (v === effect) effects.delete(k);
        },
        connect(signal, cb) {
            if (signal === "destroy") destroyHandlers.push(cb);
            return Symbol(signal);
        },
        _fireDestroy() { for (const cb of destroyHandlers) cb(); },
        _effectCount: () => effects.size,
        _destroyHandlerCount: () => destroyHandlers.length,
    };
}

function makeWindow({ type = Meta.WindowType.NORMAL, width = 800, height = 600 } = {}) {
    const signalHandlers = new Map();
    const win = {
        get_window_type: () => type,
        get_frame_rect: () => ({ x: 0, y: 0, width, height }),
        get_maximized: () => 0,
        is_fullscreen: () => false,
        connect(signal, cb) {
            if (!signalHandlers.has(signal)) signalHandlers.set(signal, []);
            const id = Symbol(signal);
            signalHandlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect(id) {
            for (const [sig, cbs] of signalHandlers)
                signalHandlers.set(sig, cbs.filter(h => h.id !== id));
        },
    };
    win.get_compositor_private = () => actorFor(win);
    return win;
}

// Actors are looked up by window; tests register them via global.get_window_actors.
const actorMap = new WeakMap();
function actorFor(win) { return actorMap.get(win); }
function link(win, actor) { actorMap.set(win, actor); }

describe("RoundedCorners", () => {
    beforeEach(() => {
        setupGnomeGlobals();
        // global.get_window_actors is not part of the shared gnome-globals
        // stub (other src/ modules already guard it with `?.() ?? []`);
        // tests populate it per-case.
        globalThis.global.get_window_actors = () => [];
    });

    describe("enable/disable lifecycle", () => {
        it("does nothing when rounded-corners-enabled is false, but still watches for it turning on", () => {
            const settings = makeSettings({ roundedCornersEnabled: false });
            const rc = new RoundedCorners(settings, makeLogger());
            assert.doesNotThrow(() => rc.enable());
            assert.equal(rc._signalIds.length, 0);
        });

        it("connects window-created and settings signals on enable", () => {
            const settings = makeSettings();
            const rc = new RoundedCorners(settings, makeLogger());
            rc.enable();
            assert.ok(rc._signalIds.length > 0);
            assert.ok(rc._settingsSignalIds.length > 0);
        });

        it("is idempotent: calling enable() twice does not duplicate signal connections", () => {
            const settings = makeSettings();
            const rc = new RoundedCorners(settings, makeLogger());
            rc.enable();
            const n1 = rc._signalIds.length;
            const s1 = rc._settingsSignalIds.length;
            rc.enable();
            assert.equal(rc._signalIds.length, n1);
            assert.equal(rc._settingsSignalIds.length, s1);
        });

        it("disable() clears all tracked signals and pending sources", () => {
            const settings = makeSettings();
            const rc = new RoundedCorners(settings, makeLogger());
            rc.enable();
            rc.disable();
            assert.equal(rc._signalIds.length, 0);
            assert.equal(rc._settingsSignalIds.length, 0);
            assert.equal(rc._pendingSources.size, 0);
        });

        it("disable() is safe to call when never enabled, or twice in a row", () => {
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            assert.doesNotThrow(() => rc.disable());
            rc.enable();
            rc.disable();
            assert.doesNotThrow(() => rc.disable());
        });
    });

    describe("window-type filtering", () => {
        it("applies the effect to a NORMAL window", () => {
            const win = makeWindow({ type: Meta.WindowType.NORMAL });
            const actor = makeActor(win);
            link(win, actor);
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            rc._applyToWindow(win);
            assert.equal(actor._effectCount(), 1);
        });

        // Regression: rounded corners used to be restricted to
        // Meta.WindowType.NORMAL only, so ordinary GTK dialogs (Settings
        // panels, Nautilus/GTK4 file-chooser & properties dialogs) never got
        // rounded corners even though they are regular CSD top-levels.
        it("applies the effect to a DIALOG window", () => {
            const win = makeWindow({ type: Meta.WindowType.DIALOG });
            const actor = makeActor(win);
            link(win, actor);
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            rc._applyToWindow(win);
            assert.equal(actor._effectCount(), 1);
        });

        it("applies the effect to a MODAL_DIALOG window", () => {
            const win = makeWindow({ type: Meta.WindowType.MODAL_DIALOG });
            const actor = makeActor(win);
            link(win, actor);
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            rc._applyToWindow(win);
            assert.equal(actor._effectCount(), 1);
        });

        it("does not apply the effect to a DOCK/UTILITY/tooltip-like window", () => {
            for (const type of [Meta.WindowType.DOCK, Meta.WindowType.UTILITY, Meta.WindowType.TOOLTIP]) {
                const win = makeWindow({ type });
                const actor = makeActor(win);
                link(win, actor);
                const rc = new RoundedCorners(makeSettings(), makeLogger());
                rc._applyToWindow(win);
                assert.equal(actor._effectCount(), 0, `type ${type} should not be rounded`);
            }
        });
    });

    describe("per-actor destroy-handler leak", () => {
        // Regression: _applyToWindow() re-entered the "connect maximize/size
        // watchers" branch (guarded only by `!actor._wtcRCSignals`) every
        // time a window was re-applied after a disable() cycle (disable()
        // resets _wtcRCSignals to null), and unconditionally added a brand
        // new "destroy" listener on the actor each time — accumulating one
        // extra listener per enable/disable cycle for any window that
        // survives across cycles.
        it("only attaches one destroy handler across multiple enable/disable cycles", () => {
            const win = makeWindow();
            const actor = makeActor(win);
            link(win, actor);
            globalThis.global.get_window_actors = () => [actor];

            const settings = makeSettings();
            const rc = new RoundedCorners(settings, makeLogger());

            rc.enable();
            rc.disable();
            rc.enable();
            rc.disable();
            rc.enable();

            assert.equal(actor._destroyHandlerCount(), 1);
        });
    });

    describe("defensive global.get_window_actors access", () => {
        it("enable()/_applyToAll() does not throw when global.get_window_actors is unavailable", () => {
            delete globalThis.global.get_window_actors;
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            assert.doesNotThrow(() => rc.enable());
        });

        it("disable()/_removeFromAll() does not throw when global.get_window_actors is unavailable", () => {
            const rc = new RoundedCorners(makeSettings(), makeLogger());
            rc.enable();
            delete globalThis.global.get_window_actors;
            assert.doesNotThrow(() => rc.disable());
        });
    });
});
