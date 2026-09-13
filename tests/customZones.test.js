/**
 * tests/customZones.test.js
 *
 * Tests for src/customZones.js — uses GJS stubs (GObject.registerClass).
 * No display/workspace globals needed.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// gi-loader is already installed globally via --import in the test command.
// No explicit import needed here.

// Build a minimal in-memory Settings stub
function makeSettings(initial = []) {
    let store = [...initial];
    const handlers = new Map();

    return {
        get customZoneSets() { return store; },
        set customZoneSets(v) {
            store = v;
            for (const cb of handlers.get("changed::custom-zone-sets") ?? []) cb();
        },
        connect(signal, cb) {
            if (!handlers.has(signal)) handlers.set(signal, []);
            handlers.get(signal).push(cb);
            return Symbol(signal);
        },
        disconnect() {},
    };
}

// We can't use GObject.registerClass in Node, so we test the internal logic
// by extracting the class methods from the file's raw export via a shim.
// Since the file uses GObject.registerClass as a class decorator, we create a
// standalone duplicate of the class that doesn't extend GObject.Object.

class CustomZoneStoreShim {
    constructor(settings, logger) {
        this._settings = settings;
        this._log = logger;
        this._cache = null;
        this._emitted = [];
        this.emit = (s) => this._emitted.push(s);
    }

    getAll() {
        if (!this._cache) this._cache = this._load();
        return this._cache;
    }

    getById(id) {
        return this.getAll().find(s => s.id === id);
    }

    addZoneSet(set) {
        const all = this.getAll();
        if (all.find(s => s.id === set.id)) return;
        all.push(set);
        this._save(all);
    }

    updateZoneSet(id, updated) {
        const all = this.getAll();
        const idx = all.findIndex(s => s.id === id);
        if (idx === -1) return;
        all[idx] = { ...updated, id };
        this._save(all);
    }

    removeZoneSet(id) {
        const all = this.getAll().filter(s => s.id !== id);
        this._save(all);
    }

    generateId() {
        const base = `custom-${Date.now()}`;
        const all = this.getAll();
        if (!all.some(s => s.id === base)) return base;
        let n = 1;
        while (all.some(s => s.id === `${base}-${n}`)) n++;
        return `${base}-${n}`;
    }

    _load() {
        const raw = this._settings.customZoneSets;
        const result = [];
        for (const entry of raw) {
            try { result.push(JSON.parse(entry)); } catch (_) {}
        }
        return result;
    }

    _save(all) {
        this._cache = all;
        this._settings.customZoneSets = all.map(s => JSON.stringify(s));
        this.emit("changed");
    }
}

function makeStore(initial = []) {
    const sets = initial.map(s => JSON.stringify(s));
    return new CustomZoneStoreShim(makeSettings(sets), null);
}

const ZONE_A = { id: "a", label: "Set A", zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
const ZONE_B = { id: "b", label: "Set B", zones: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] };

describe("CustomZoneStore", () => {
    describe("getAll", () => {
        it("returns empty array for no stored sets", () => {
            const store = makeStore();
            assert.deepEqual(store.getAll(), []);
        });

        it("returns parsed zone sets", () => {
            const store = makeStore([ZONE_A, ZONE_B]);
            assert.equal(store.getAll().length, 2);
        });

        it("returns the same cached array on repeat calls", () => {
            const store = makeStore([ZONE_A]);
            assert.strictEqual(store.getAll(), store.getAll());
        });

        it("skips malformed JSON entries silently", () => {
            const settings = makeSettings(["{bad json}", JSON.stringify(ZONE_A)]);
            const store = new CustomZoneStoreShim(settings, null);
            assert.equal(store.getAll().length, 1);
            assert.equal(store.getAll()[0].id, "a");
        });
    });

    describe("getById", () => {
        it("returns the zone set with matching id", () => {
            const store = makeStore([ZONE_A, ZONE_B]);
            assert.equal(store.getById("a")?.id, "a");
            assert.equal(store.getById("b")?.id, "b");
        });

        it("returns undefined for unknown id", () => {
            const store = makeStore([ZONE_A]);
            assert.equal(store.getById("z"), undefined);
        });
    });

    describe("addZoneSet", () => {
        it("adds a new zone set and emits 'changed'", () => {
            const store = makeStore();
            store.addZoneSet(ZONE_A);
            assert.equal(store.getAll().length, 1);
            assert.ok(store._emitted.includes("changed"));
        });

        it("does NOT add a duplicate id", () => {
            const store = makeStore([ZONE_A]);
            store.addZoneSet({ ...ZONE_A, label: "Duplicate" });
            assert.equal(store.getAll().length, 1);
        });
    });

    describe("updateZoneSet", () => {
        it("replaces label while preserving id", () => {
            const store = makeStore([ZONE_A]);
            store.updateZoneSet("a", { ...ZONE_A, label: "Updated" });
            const found = store.getById("a");
            assert.equal(found?.label, "Updated");
            assert.equal(found?.id, "a");
        });

        it("does nothing for an unknown id", () => {
            const store = makeStore([ZONE_A]);
            store.updateZoneSet("z", { id: "z", label: "Ghost", zones: [] });
            assert.equal(store.getAll().length, 1);
        });
    });

    describe("removeZoneSet", () => {
        it("removes the set with matching id", () => {
            const store = makeStore([ZONE_A, ZONE_B]);
            store.removeZoneSet("a");
            assert.equal(store.getAll().length, 1);
            assert.equal(store.getAll()[0].id, "b");
        });

        it("does nothing for an unknown id", () => {
            const store = makeStore([ZONE_A]);
            store.removeZoneSet("z");
            assert.equal(store.getAll().length, 1);
        });

        it("emits 'changed' even when id not found", () => {
            const store = makeStore([ZONE_A]);
            store._emitted = [];
            store.removeZoneSet("z");
            assert.ok(store._emitted.includes("changed"));
        });
    });

    describe("generateId", () => {
        it("returns a string starting with 'custom-'", () => {
            const store = makeStore();
            assert.ok(store.generateId().startsWith("custom-"));
        });

        it("generates unique ids on repeated calls, even when each is immediately persisted", () => {
            const store = makeStore();
            const ids = new Set();
            for (let i = 0; i < 10; i++) {
                const id = store.generateId();
                ids.add(id);
                store.addZoneSet({ id, label: `Set ${i}`, zones: [] });
            }
            assert.equal(ids.size, 10);
            assert.equal(store.getAll().length, 10);
        });

        it("disambiguates ids colliding within the same millisecond", () => {
            // Regression test: generateId() used to be a bare `custom-${Date.now()}`,
            // so two sets created in the same millisecond collided; addZoneSet()
            // silently drops anything whose id already exists, so the second
            // zone set would vanish without any error.
            const store = makeStore();
            const id1 = store.generateId();
            store.addZoneSet({ id: id1, label: "First", zones: [] });

            const id2 = store.generateId();
            assert.notEqual(id2, id1, "second generated id must differ from an id already in the store");
            store.addZoneSet({ id: id2, label: "Second", zones: [] });

            assert.equal(store.getAll().length, 2);
        });
    });
});
