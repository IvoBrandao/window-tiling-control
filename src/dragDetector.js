/**
 * Window Tiling Control — src/dragDetector.js
 * Detects window drag operations via grab-op signals + 16ms pointer polling.
 * Emits GObject signals "zone-hovered" and "zone-selected".
 */

import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Meta from "gi://Meta";

/** Preview must dwell under the pointer this long (µs) before it activates. */
const ACTIVATION_DELAY_US = 160 * 1000; // 160ms — matches Windows 11's feel

export const DragDetector = GObject.registerClass(
    {
        Signals: {
            /**
             * Emitted when the pointer hovers over a snap zone during drag.
             * Read hoveredZone for zone details (rect etc.).
             * @param {string} presetId
             * @param {number} monitorIndex
             * @param {number} zoneIndex
             */
            "zone-hovered": {
                param_types: [
                    GObject.TYPE_STRING,  // presetId (or "")
                    GObject.TYPE_INT,     // monitorIndex
                    GObject.TYPE_INT,     // zoneIndex (-1 if none)
                ],
            },
            /**
             * Emitted when a drag ends (with or without a zone selection).
             * Read selectedZone for zone details (rect etc.).
             */
            "zone-selected": {
                param_types: [
                    GObject.TYPE_STRING,
                    GObject.TYPE_INT,
                    GObject.TYPE_INT,
                ],
            },
        },
    },
    class DragDetector extends GObject.Object {
        _init(settings, zoneManager, multiMonitor, logger) {
            super._init();
            this._settings = settings;
            this._zoneManager = zoneManager;
            this._multiMonitor = multiMonitor;
            this._log = logger;

            this._signalIds = [];
            this._pollId = null;
            this._enabled = false;
            this._dragging = false;
            this._draggedWindow = null;
            this._lastHoveredZone = null; // { presetId, monitorIndex, rect, zoneIndex }
            // Dwell (activation delay) state — a zone must persist under the
            // pointer for ACTIVATION_DELAY_US before it visually activates, so
            // highlights don't flicker in the instant the pointer grazes an edge.
            this._candidateSig = null;
            this._candidateSince = 0;

            /** @type {{ presetId: string, monitorIndex: number, rect, zoneIndex: number }|null} */
            this.hoveredZone = null;
            /** @type {{ presetId: string, monitorIndex: number, rect, zoneIndex: number }|null} */
            this.selectedZone = null;
        }

        enable() {
            // Idempotent: enable() may be re-invoked on session-mode changes.
            if (this._enabled) return;
            this._enabled = true;

            // GNOME 45-50: grab-op-begin(display, window, grabOp) — 3 params.
            // Some versions drop the 3rd param; fall back to display.get_grab_op().
            this._signalIds.push(
                global.display.connect("grab-op-begin", (_dpy, win, op) => {
                    try {
                        const grabOp = op ?? global.display.get_grab_op?.() ?? 0;
                        // Accept mouse-move, keyboard-move, and unconstrained move
                        if (grabOp === Meta.GrabOp.MOVING ||
                            grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
                            grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED)
                            this._onDragBegin(win);
                    } catch (e) { this._log?.error(`DragDetector grab-begin: ${e}`); }
                }),
                global.display.connect("grab-op-end", (_dpy, win, _op) => {
                    try {
                        if (this._dragging && win === this._draggedWindow)
                            this._onDragEnd();
                    } catch (e) { this._log?.error(`DragDetector grab-end: ${e}`); }
                })
            );
        }

        disable() {
            if (!this._enabled) return;
            this._enabled = false;
            this._stopPolling();
            for (const id of this._signalIds)
                try { global.display.disconnect(id); } catch (_) {}
            this._signalIds = [];
            this._dragging = false;
            this._draggedWindow = null;
        }

        // ------------------------------------------------------------------ private

        _onDragBegin(metaWindow) {
            // Always poll so drag-to-snap works even with highlights disabled;
            // that setting gates only the highlight drawing (see _poll).
            this._dragging = true;
            this._draggedWindow = metaWindow;
            this._lastHoveredZone = null;
            this._candidateSig = null;
            this._candidateSince = 0;
            this._lastPx = null;
            this._lastPy = null;
            this._startPolling();
        }

        _onDragEnd() {
            this._stopPolling();
            this._dragging = false;

            const last = this._lastHoveredZone;
            const win  = this._draggedWindow;

            if (last?.isMaximize) {
                // Top-edge drag → maximize directly
                win?.maximize(Meta.MaximizeFlags.BOTH);
                this.selectedZone = null;
                this.emit("zone-selected", "", -1, -1);
            } else if (last) {
                this.selectedZone = { presetId: last.presetId, monitorIndex: last.monitorIndex, rect: last.rect, zoneIndex: last.zoneIndex };
                this.emit("zone-selected",
                    last.presetId,
                    last.monitorIndex,
                    last.zoneIndex
                );
            } else {
                this.selectedZone = null;
                this.emit("zone-selected", "", -1, -1);
            }

            this._lastHoveredZone = null;
            this._draggedWindow = null;
        }

        _startPolling() {
            if (this._pollId) return;
            this._pollStart = GLib.get_monotonic_time();
            const MAX_POLL_US = 30 * 1000000; // 30 seconds safety limit
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this._dragging ||
                    GLib.get_monotonic_time() - this._pollStart > MAX_POLL_US) {
                    this._pollId = null;
                    if (this._dragging) this._onDragEnd();
                    return GLib.SOURCE_REMOVE;
                }
                try { this._poll(); }
                catch (e) { this._log?.error(`DragDetector poll: ${e}`); }
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPolling() {
            if (this._pollId) {
                GLib.Source.remove(this._pollId);
                this._pollId = null;
            }
        }

        _poll() {
            const [px, py] = global.get_pointer();

            // Skip all zone math when the pointer hasn't moved since the last
            // 16ms frame — nothing can change, so there's no work to do.
            if (px === this._lastPx && py === this._lastPy) return;
            this._lastPx = px;
            this._lastPy = py;

            const showHighlight = this._settings.dragHighlightEnabled;
            const monitorIndex = this._zoneManager.getMonitorForPoint(px, py);

            // Windows 11-style: only reveal snap zones when the pointer is near
            // a screen edge or corner — NOT across the whole screen the instant
            // a drag starts. Edge/corner proximity is the sole trigger.
            const edgeZone = this._getEdgeZone(px, py, monitorIndex);

            if (!edgeZone) {
                // Away from any edge — clear pending candidate and hide.
                this._candidateSig = null;
                if (this._lastHoveredZone) {
                    this._lastHoveredZone = null;
                    this.hoveredZone = null;
                    if (showHighlight)
                        this.emit("zone-hovered", "", monitorIndex, -1);
                }
                return;
            }

            const { presetId, rect, zoneIndex, isMaximize } = edgeZone;
            const sig = `${presetId}|${monitorIndex}|${zoneIndex}`;

            // Already the committed (visible) zone — nothing to do.
            if (this._lastHoveredZone &&
                this._lastHoveredZone.presetId === presetId &&
                this._lastHoveredZone.monitorIndex === monitorIndex &&
                this._lastHoveredZone.zoneIndex === zoneIndex) {
                this._candidateSig = null;
                return;
            }

            // Dwell: a new zone must persist under the pointer for a short delay
            // before it activates. This stops the highlight from flashing the
            // instant the pointer grazes an edge on the way somewhere else.
            const now = GLib.get_monotonic_time();
            if (this._candidateSig !== sig) {
                this._candidateSig = sig;
                this._candidateSince = now;
                return;
            }
            if (now - this._candidateSince < ACTIVATION_DELAY_US) return;

            // Commit the zone. We ALWAYS record it (so drag-to-snap works even
            // with highlights disabled) but only emit the visual when enabled.
            this._candidateSig = null;
            this._lastHoveredZone = { presetId, monitorIndex, rect, zoneIndex, isMaximize };
            this.hoveredZone = { presetId, monitorIndex, rect, zoneIndex };
            if (showHighlight)
                this.emit("zone-hovered", presetId, monitorIndex, zoneIndex);
        }

        /**
         * Check whether the pointer is within the edge/corner snap threshold of
         * the monitor and return a hardcoded zone if so.
         *
         * Uses the MONITOR geometry for proximity detection (users drag to the
         * physical screen edge) but the WORKAREA for the resulting zone rects
         * (so windows don't overlap the panel/taskbar).
         *
         * Priority: corners > top edge (maximize) > left/right edges.
         *
         * @returns {{ presetId, zoneIndex, rect: Meta.Rectangle, isMaximize: boolean }|null}
         */
        _getEdgeZone(px, py, monitorIndex) {
            // Monitor geometry for proximity detection
            const mon = global.display.get_monitor_geometry(monitorIndex);
            if (!mon) return null;

            const T = Math.max(this._settings.dragEdgeThreshold ?? 20, 20);
            const C = T * 2; // corner detection box

            // Detect proximity to MONITOR edges (not workarea)
            const nearLeft   = px < mon.x + C;
            const nearRight  = px > mon.x + mon.width - C;
            const nearTop    = py < mon.y + C;
            const nearBottom = py > mon.y + mon.height - C;

            // Resolve the resulting rect from ZoneManager so gaps (inner/outer)
            // and the workarea are applied consistently — no duplicated math.
            const zr = (presetId, zoneIndex, isMaximize = false) => {
                const rects = this._zoneManager.getZoneRects(presetId, monitorIndex);
                const rect = rects[zoneIndex];
                return rect ? { presetId, zoneIndex, rect, isMaximize } : null;
            };

            // Corners (evaluated first — highest priority)
            if (nearLeft  && nearTop)    return zr("quarters", 0);
            if (nearRight && nearTop)    return zr("quarters", 1);
            if (nearLeft  && nearBottom) return zr("quarters", 2);
            if (nearRight && nearBottom) return zr("quarters", 3);

            // Top edge → maximize. A full-workarea preview shows during hover;
            // the window is actually maximized on release (see _onDragEnd).
            if (py < mon.y + T) return zr("__maximize__", 0, true);

            // Side edges → left/right halves
            if (px < mon.x + T)              return zr("halves", 0);
            if (px > mon.x + mon.width - T)  return zr("halves", 1);

            return null;
        }
    });