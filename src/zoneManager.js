/**
 * Window Tiling Control — src/zoneManager.js
 * Converts normalized preset zone rects → pixel Meta.Rectangle values,
 * and applies window snap assignments.
 */

import Meta from "gi://Meta";
import GLib from "gi://GLib";
import { getPresetById, PRESETS } from "./layoutPresets.js";
import { makeRect, getMaximizeFlags } from "./compat.js";

export class ZoneManager {
    constructor(settings, customZones, logger) {
        this._settings = settings;
        this._customZones = customZones;
        this._log = logger;

        // Memoized pixel rects keyed by preset|monitor|gap|workarea.
        // getZoneRects is called on every drag-poll frame (~60/s), so caching
        // avoids recomputing normalized→pixel math and Meta.Rectangle allocs.
        this._rectCache = new Map();
        this._cacheSignalId = this._customZones?.connect?.(
            "changed", () => this.invalidateCache()
        ) ?? null;

        // Pending one-shot sources for deferred re-apply of window geometry.
        this._pendingSources = new Set();
    }

    /** Clear the memoized zone-rect cache (custom zones or monitors changed). */
    invalidateCache() {
        this._rectCache.clear();
    }

    destroy() {
        if (this._cacheSignalId !== null) {
            try { this._customZones.disconnect(this._cacheSignalId); } catch (_) {}
            this._cacheSignalId = null;
        }
        for (const id of this._pendingSources)
            try { GLib.Source.remove(id); } catch (_) {}
        this._pendingSources.clear();
        this._rectCache.clear();
    }

    // ------------------------------------------------------------------ zone rect calculation

    /**
     * Get pixel zone rects for a preset on a specific monitor.
     *
     * @param {string} presetId     - built-in preset id OR custom zone set id
     * @param {number} monitorIndex - monitor index (from global.display)
     * @param {number} [gapSize]    - gap override; falls back to settings
     * @returns {Meta.Rectangle[]}
     */
    getZoneRects(presetId, monitorIndex, gapSize) {
        const gap = gapSize ?? this._settings.windowGapSize;
        const workarea = this._getWorkarea(monitorIndex);
        if (!workarea) return [];

        // Synthetic "maximize" preset: a single full-workarea rect. Used to
        // render a preview when the pointer drags into the top edge.
        if (presetId === "__maximize__") {
            return [makeRect({
                x: workarea.x, y: workarea.y,
                width: workarea.width, height: workarea.height,
            })];
        }

        // Cache key includes the workarea geometry so it self-invalidates when
        // the monitor/panel layout changes without an explicit signal.
        const outer = this._settings.outerGapSize ?? gap;
        const key = `${presetId}|${monitorIndex}|${gap}|${outer}|` +
            `${workarea.x},${workarea.y},${workarea.width},${workarea.height}`;
        const cached = this._rectCache.get(key);
        if (cached) return cached;

        const preset = getPresetById(presetId) ?? this._customZones.getById(presetId);
        if (!preset) {
            this._log?.warn(`ZoneManager: unknown preset '${presetId}'`);
            return [];
        }

        const rects = preset.zones.map(norm => this._normToPixel(norm, workarea, gap, outer));
        this._rectCache.set(key, rects);
        return rects;
    }

    /**
     * Get zone rects for all built-in presets on a monitor (used by overlay).
     *
     * @param {number} monitorIndex
     * @returns {Map<string, Meta.Rectangle[]>}
     */
    getAllPresetRects(monitorIndex) {
        const map = new Map();
        const all = [...PRESETS, ...this._customZones.getAll()];
        for (const preset of all) {
            map.set(preset.id, this.getZoneRects(preset.id, monitorIndex));
        }
        return map;
    }

    /**
     * Find which zone (if any) the given pointer position falls within,
     * based on proximity to zone edges.
     *
     * @param {number} px           - pointer x (global coords)
     * @param {number} py           - pointer y
     * @param {string} presetId
     * @param {number} monitorIndex
     * @returns {{ rect: Meta.Rectangle, zoneIndex: number } | null}
     */
    getHoveredZone(px, py, presetId, monitorIndex) {
        const threshold = this._settings.dragEdgeThreshold;
        const rects = this.getZoneRects(presetId, monitorIndex);
        const workarea = this._getWorkarea(monitorIndex);
        if (!workarea) return null;

        // Check if pointer inside workarea at all
        if (px < workarea.x || px > workarea.x + workarea.width ||
            py < workarea.y || py > workarea.y + workarea.height)
            return null;

        // Find zone whose edge is closest to pointer
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const nearLeft   = Math.abs(px - r.x) < threshold && py >= r.y && py <= r.y + r.height;
            const nearRight  = Math.abs(px - (r.x + r.width)) < threshold && py >= r.y && py <= r.y + r.height;
            const nearTop    = Math.abs(py - r.y) < threshold && px >= r.x && px <= r.x + r.width;
            const nearBottom = Math.abs(py - (r.y + r.height)) < threshold && px >= r.x && px <= r.x + r.width;

            if (nearLeft || nearRight || nearTop || nearBottom)
                return { rect: r, zoneIndex: i };
        }

        // Fallback: check if pointer is inside any zone
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (px >= r.x && px <= r.x + r.width &&
                py >= r.y && py <= r.y + r.height)
                return { rect: r, zoneIndex: i };
        }

        return null;
    }

    /**
     * Check which zone index best matches a given pixel rect (used when
     * moving windows across monitors to find an equivalent zone).
     *
     * @param {Meta.Rectangle} rect  - current zone rect (from old monitor)
     * @param {string} presetId
     * @param {number} monitorIndex
     * @returns {number} best matching zone index, or 0 as fallback
     */
    findClosestZoneIndex(rect, presetId, monitorIndex) {
        const rects = this.getZoneRects(presetId, monitorIndex);
        if (!rects.length) return 0;

        const oldWorkarea = this._getWorkareaForRect(rect);
        if (!oldWorkarea) return 0;

        // Normalise the old rect
        const normX = (rect.x - oldWorkarea.x) / oldWorkarea.width;
        const normY = (rect.y - oldWorkarea.y) / oldWorkarea.height;

        const newWorkarea = this._getWorkarea(monitorIndex);
        if (!newWorkarea) return 0;

        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const rNormX = (r.x - newWorkarea.x) / newWorkarea.width;
            const rNormY = (r.y - newWorkarea.y) / newWorkarea.height;
            const dist = Math.hypot(normX - rNormX, normY - rNormY);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }

    // ------------------------------------------------------------------ window assignment

    /**
     * Snap a window to a zone rect.
     *
     * Always applies the geometry immediately via move_resize_frame.
     * Mutter's compositor provides its own smooth window transitions,
     * so we do not need custom actor animation (easeRect was unreliable
     * because Mutter manages compositor actor allocation and overrides
     * animated x/y/width/height properties).
     *
     * @param {Meta.Window} metaWindow
     * @param {Meta.Rectangle} zoneRect
     */
    assignWindowToZone(metaWindow, zoneRect) {
        if (!metaWindow) return;

        const apply = () => {
            metaWindow.move_resize_frame(
                true,
                zoneRect.x, zoneRect.y,
                zoneRect.width, zoneRect.height
            );
        };

        // Is the window maximized OR in a Mutter tiled state? (edge-tiled
        // windows report maximized_vertically.) Both must be cleared first.
        const maxFlags = getMaximizeFlags(metaWindow);

        if (!maxFlags) {
            // Common case (quarter→quarter, half→quarter, …): a single
            // synchronous move. No double-apply — that caused a visible glitch.
            apply();
            return;
        }

        // Maximized/tiled: unmaximizing restores the saved geometry
        // ASYNCHRONOUSLY, which would override a synchronous move and leave the
        // window "stuck" in place. So unmaximize now and apply on the next idle,
        // after Mutter has finished its restore.
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);

        let sid;
        sid = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pendingSources.delete(sid);
            try {
                if (metaWindow.get_compositor_private?.())
                    apply();
            } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
        this._pendingSources.add(sid);
    }

    /**
     * Return the monitor index under the given pixel point.
     *
     * @param {number} px
     * @param {number} py
     * @returns {number}
     */
    getMonitorForPoint(px, py) {
        const n = global.display.get_n_monitors();
        for (let i = 0; i < n; i++) {
            const g = global.display.get_monitor_geometry(i);
            if (px >= g.x && px < g.x + g.width &&
                py >= g.y && py < g.y + g.height)
                return i;
        }
        return global.display.get_current_monitor();
    }

    // ------------------------------------------------------------------ private helpers

    /**
     * Convert a normalized rect to a pixel Meta.Rectangle within a workarea.
     *
     * Edge-aware gaps: an edge on the workarea boundary gets the OUTER gap; an
     * internal edge (shared with a neighbouring zone) gets half the INNER gap,
     * so two adjacent zones leave exactly `inner` px between them.
     */
    _normToPixel(norm, workarea, inner, outer = inner) {
        const wa = workarea;
        const half = inner / 2;
        const eps = 0.001;

        const gL = norm.x <= eps                ? outer : half;
        const gT = norm.y <= eps                ? outer : half;
        const gR = norm.x + norm.w >= 1 - eps   ? outer : half;
        const gB = norm.y + norm.h >= 1 - eps   ? outer : half;

        const x = Math.round(wa.x + norm.x * wa.width  + gL);
        const y = Math.round(wa.y + norm.y * wa.height + gT);
        const w = Math.round(norm.w * wa.width  - gL - gR);
        const h = Math.round(norm.h * wa.height - gT - gB);

        // Clamp to workarea to avoid tiny rounding overflows
        return makeRect({
            x: Math.max(x, wa.x),
            y: Math.max(y, wa.y),
            width:  Math.max(w, 40),
            height: Math.max(h, 40),
        });
    }

    /**
     * Get the workarea for a monitor, merging panel/dock exclusions.
     *
     * get_work_area_for_monitor() can be called on ANY Meta.Window to return
     * the workarea for ANY monitor, so we just need a window reference — it
     * doesn't have to be on the target monitor.
     *
     * @param {number} monitorIndex
     * @returns {Meta.Rectangle|null}
     */
    _getWorkarea(monitorIndex) {
        try {
            // Prefer the focused window (cheapest lookup)
            const focused = global.display.get_focus_window();
            if (focused) {
                return focused.get_work_area_for_monitor(monitorIndex);
            }
            // Any managed window will do — use compositor actor list (fast C call)
            const actors = global.get_window_actors?.() ?? [];
            for (const actor of actors) {
                const w = actor.meta_window;
                if (w) return w.get_work_area_for_monitor(monitorIndex);
            }
            // Last resort: raw geometry (no panel subtraction)
            return global.display.get_monitor_geometry(monitorIndex);
        } catch (e) {
            this._log?.error("ZoneManager._getWorkarea:", e.message);
            return null;
        }
    }

    _getWorkareaForRect(rect) {
        const n = global.display.get_n_monitors();
        // Match by the rect's centre against full (x+y) monitor containment so
        // vertically-stacked monitors resolve correctly.
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        for (let i = 0; i < n; i++) {
            const g = global.display.get_monitor_geometry(i);
            if (cx >= g.x && cx < g.x + g.width &&
                cy >= g.y && cy < g.y + g.height)
                return this._getWorkarea(i);
        }
        return null;
    }
}
