/**
 * Window Tiling Control — src/customZones.js
 * Stores and retrieves user-defined zone sets from GSettings.
 *
 * Each ZoneSet: { id: string, label: string, zones: NormRect[] }
 * Serialised as JSON strings in the GSettings key "custom-zone-sets" (type as).
 */

import GObject from "gi://GObject";

export const CustomZoneStore = GObject.registerClass(
    {
        Signals: {
            "changed": {},
        },
    },
    class CustomZoneStore extends GObject.Object {
        _init(settings, logger) {
            super._init();
            this._settings = settings;
            this._log = logger;
            this._cache = null; // lazy loaded
        }

        // ---------------------------------------------------------------- public API

        /** @returns {ZoneSet[]} */
        getAll() {
            if (!this._cache)
                this._cache = this._load();
            return this._cache;
        }

        /** @returns {ZoneSet|undefined} */
        getById(id) {
            return this.getAll().find(s => s.id === id);
        }

        /** Add a new zone set. id must be unique. */
        addZoneSet(set) {
            const all = this.getAll();
            if (all.find(s => s.id === set.id)) {
                this._log?.warn(`CustomZoneStore: id '${set.id}' already exists`);
                return;
            }
            all.push(set);
            this._save(all);
        }

        /** Replace an existing zone set by id. */
        updateZoneSet(id, updated) {
            const all = this.getAll();
            const idx = all.findIndex(s => s.id === id);
            if (idx === -1) {
                this._log?.warn(`CustomZoneStore: id '${id}' not found for update`);
                return;
            }
            all[idx] = { ...updated, id };
            this._save(all);
        }

        /** Remove a zone set by id. */
        removeZoneSet(id) {
            const all = this.getAll().filter(s => s.id !== id);
            this._save(all);
        }

        /**
         * Generate a unique ID for a new set.
         *
         * Date.now() alone is not sufficient: two sets created within the same
         * millisecond (e.g. a fast double-click on "Save", or scripted callers)
         * would collide, and addZoneSet() silently drops anything whose id
         * already exists — so a naive timestamp-only id could quietly lose data.
         * Disambiguate against the current store when needed.
         */
        generateId() {
            const base = `custom-${Date.now()}`;
            const all = this.getAll();
            if (!all.some(s => s.id === base))
                return base;
            let n = 1;
            while (all.some(s => s.id === `${base}-${n}`))
                n++;
            return `${base}-${n}`;
        }

        // ---------------------------------------------------------------- private

        _load() {
            const raw = this._settings.customZoneSets; // string[]
            const result = [];
            for (const entry of raw) {
                try {
                    result.push(JSON.parse(entry));
                } catch (e) {
                    this._log?.warn("CustomZoneStore: failed to parse entry", e.message);
                }
            }
            return result;
        }

        _save(all) {
            this._cache = all;
            this._settings.customZoneSets = all.map(s => JSON.stringify(s));
            this.emit("changed");
        }
    }
);
