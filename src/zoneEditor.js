/**
 * WindowTilingControl — src/zoneEditor.js
 * Full-screen visual zone editor (FancyZones-style).
 *
 * NOTE: gi://Clutter is retained here solely for Clutter.ActorAlign — Mutter's
 * actor alignment enum, which has no St/CSS replacement for programmatic use.
 *
 * User can:
 *  - Draw new zones by dragging on empty area (rubber-band)
 *  - Resize zones by dragging edge/corner handles
 *  - Delete zones with middle-click
 *  - Save the layout as a new custom zone set
 *  - Open an existing custom set for editing
 *
 * All coordinates are snapped to a configurable grid (default 12×8).
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

const HANDLE_SIZE = 10;
const MIN_ZONE_PX = 40;
const TOOLBAR_HEIGHT = 56;

export class ZoneEditor {
    constructor(settings, customZones, zoneManager, animations, logger) {
        this._settings = settings;
        this._customZones = customZones;
        this._zoneManager = zoneManager;
        this._animations = animations;
        this._log = logger;

        this._backdrop = null;
        this._canvas = null;
        this._toolbar = null;
        this._nameEntry = null;

        /** @type {{ normRect: NormRect, actor: St.Bin, handles: St.Bin[] }[]} */
        this._zones = [];

        this._monitorIndex = 0;
        this._editingSetId = null; // null = new set

        // Rubber-band draw state
        this._drawing = false;
        this._drawStart = null; // {x, y} in canvas coords
        this._rubberband = null;

        // Drag resize state
        this._draggingHandle = null; // { zoneIdx, edge, startX, startY, origRect }

        this._captureId = null;
        this._grab = null;
    }

    // ------------------------------------------------------------------ public

    open(monitorIndex = 0, existingSetId = null) {
        if (this._backdrop) this.close();

        this._monitorIndex = monitorIndex;
        this._editingSetId = existingSetId;

        // Edit in workarea space (panel/dock excluded) — the same space
        // ZoneManager applies zones in, so drawn zones map 1:1 when used.
        const geom = this._area =
            this._zoneManager._getWorkarea(monitorIndex) ??
            global.display.get_monitor_geometry(monitorIndex);

        // Dark backdrop covering the entire monitor
        this._backdrop = new St.Widget({
            style_class: "wtc-editor-backdrop",
            reactive: true,
            can_focus: true,
        });
        this._backdrop.set_position(geom.x, geom.y);
        this._backdrop.set_size(geom.width, geom.height);

        // Canvas for zone actors (sits on top of backdrop)
        this._canvas = new St.Widget({
            reactive: false,
            can_focus: false,
        });
        this._canvas.set_position(0, 0);
        this._canvas.set_size(geom.width, geom.height);
        this._backdrop.add_child(this._canvas);

        // Instruction overlay (shown initially, hidden after first zone drawn)
        this._instructionLabel = new St.Label({
            text: _("Click and drag to draw zones\n" +
                     "Drag corner/edge handles to resize\n" +
                     "Middle-click a zone to delete it\n" +
                     "Press Enter to save · Escape to cancel"),
            style_class: "wtc-editor-instructions",
        });
        this._instructionLabel.set_position(
            Math.round(geom.width / 2 - 200),
            Math.round(geom.height / 2 - 60)
        );
        this._backdrop.add_child(this._instructionLabel);

        // Toolbar at bottom
        this._toolbar = this._buildToolbar();
        this._toolbar.set_position(0, geom.height - TOOLBAR_HEIGHT);
        this._toolbar.set_size(geom.width, TOOLBAR_HEIGHT);
        this._backdrop.add_child(this._toolbar);

        Main.uiGroup.add_child(this._backdrop);
        this._animations.fadeIn(this._backdrop);

        // Load existing zones or start blank
        if (existingSetId) {
            const set = this._customZones.getById(existingSetId);
            if (set) {
                for (const normRect of set.zones)
                    this._addZoneActor(normRect);
            }
        }

        // Event handling: captured-event was removed from ClutterActor in
        // GNOME 47+.  Try it first (GNOME 45-46), then fall back to a Clutter
        // grab + the regular "event" signal (GNOME 47-49).
        const handler = (_a, event) => {
            const type = event.type();

            if (type === Clutter.EventType.BUTTON_PRESS) {
                return this._onPress(event);
            } else if (type === Clutter.EventType.MOTION) {
                return this._onMotion(event);
            } else if (type === Clutter.EventType.BUTTON_RELEASE) {
                return this._onRelease(event);
            } else if (type === Clutter.EventType.KEY_PRESS) {
                const sym = event.get_key_symbol();
                if (sym === 0xFF1B /* Escape */) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                // Enter / Return / Keypad-Enter → commit (save) the layout.
                // Ignored while typing in the name entry (it keeps key focus).
                if ((sym === 0xFF0D /* Return */ || sym === 0xFF8D /* KP_Enter */) &&
                    !this._nameEntry?.contains?.(global.stage.get_key_focus())) {
                    this._saveZones();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        };

        try {
            this._captureId = this._backdrop.connect("captured-event", handler);
        } catch (_) {
            // GNOME 47+: captured-event removed. Use grab + event instead.
            const grab = this._backdrop.grab();
            if (grab) this._grab = grab;
            this._captureId = this._backdrop.connect("event", handler);
        }

        this._backdrop.grab_key_focus();
    }

    close() {
        if (!this._backdrop) return;

        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }

        if (this._captureId) {
            this._backdrop.disconnect(this._captureId);
            this._captureId = null;
        }

        const backdrop = this._backdrop;
        this._backdrop = null;
        this._canvas = null;
        this._toolbar = null;
        this._nameEntry = null;
        this._instructionLabel = null;
        this._zones = [];
        this._drawing = false;
        this._rubberband = null;
        this._draggingHandle = null;

        this._animations.fadeOut(backdrop, undefined, () => {
            if (Main.uiGroup.contains(backdrop)) {
                Main.uiGroup.remove_child(backdrop);
                backdrop.destroy();
            }
        });
    }

    destroy() {
        this.close();
    }

    /** @returns {boolean} whether the editor is currently open. */
    isOpen() {
        return !!this._backdrop;
    }

    /** Public save entry point (used by the open-zone-editor shortcut). */
    save() {
        this._saveZones();
    }

    // ------------------------------------------------------------------ private — toolbar

    _buildToolbar() {
        const toolbar = new St.BoxLayout({
            style_class: "wtc-editor-toolbar",
            vertical: false,
        });

        // Zone set name entry
        this._nameEntry = new St.Entry({
            hint_text: _("Layout name…"),
            text: this._editingSetId
                ? (this._customZones.getById(this._editingSetId)?.label ?? "")
                : "",
            style_class: "wtc-editor-status",
            x_expand: true,
        });
        toolbar.add_child(this._nameEntry);

        // Zone count label
        this._statusLabel = new St.Label({
            text: _("0 zones"),
            style_class: "wtc-editor-status",
            y_align: Clutter.ActorAlign.CENTER,
        });
        toolbar.add_child(this._statusLabel);

        // Reset button
        const resetBtn = new St.Button({
            label: _("Reset to Default"),
            style_class: "wtc-editor-btn",
        });
        resetBtn.connect("clicked", () => this._resetZones());
        toolbar.add_child(resetBtn);

        // Cancel button
        const cancelBtn = new St.Button({
            label: _("Cancel"),
            style_class: "wtc-editor-btn",
        });
        cancelBtn.connect("clicked", () => this.close());
        toolbar.add_child(cancelBtn);

        // Save button
        const saveBtn = new St.Button({
            label: _("Save"),
            style_class: "wtc-editor-btn wtc-editor-btn-primary",
        });
        saveBtn.connect("clicked", () => this._saveZones());
        toolbar.add_child(saveBtn);

        return toolbar;
    }

    // ------------------------------------------------------------------ private — zone actors

    _addZoneActor(normRect) {
        const geom = this._area ?? global.display.get_monitor_geometry(this._monitorIndex);
        const actor = new St.Bin({ style_class: "wtc-editor-zone", reactive: true });

        this._updateActorFromNorm(actor, normRect, geom);
        this._canvas.add_child(actor);

        const handles = this._buildHandles(actor, normRect, geom);
        for (const h of handles)
            this._canvas.add_child(h);

        const zone = { normRect, actor, handles };
        this._zones.push(zone);

        this._updateStatus();
        return this._zones.length - 1;
    }

    _buildHandles(actor, normRect, geom) {
        const edges = [
            { name: "tl", nx: 0, ny: 0 }, { name: "tr", nx: 1, ny: 0 },
            { name: "bl", nx: 0, ny: 1 }, { name: "br", nx: 1, ny: 1 },
            { name: "t",  nx: 0.5, ny: 0 }, { name: "b",  nx: 0.5, ny: 1 },
            { name: "l",  nx: 0, ny: 0.5 }, { name: "r",  nx: 1, ny: 0.5 },
        ];

        return edges.map(edge => {
            const h = new St.Bin({
                style_class: "wtc-editor-handle",
                reactive: true,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
            });

            const ax = Math.round(normRect.x * geom.width  + edge.nx * normRect.w * geom.width  - HANDLE_SIZE / 2);
            const ay = Math.round(normRect.y * geom.height + edge.ny * normRect.h * geom.height - HANDLE_SIZE / 2);
            h.set_position(ax, ay);

            // Drag to resize — handled via canvas captured event
            h._wtcEdge = edge.name;
            h._wtcZoneActor = actor;

            return h;
        });
    }

    _updateActorFromNorm(actor, normRect, geom) {
        actor.set_position(
            Math.round(normRect.x * geom.width),
            Math.round(normRect.y * geom.height)
        );
        actor.set_size(
            Math.round(normRect.w * geom.width),
            Math.round(normRect.h * geom.height)
        );
    }

    _deleteZone(zoneEntry) {
        const idx = this._zones.indexOf(zoneEntry);
        if (idx === -1) return;

        zoneEntry.actor.destroy();
        for (const h of zoneEntry.handles)
            h.destroy();

        this._zones.splice(idx, 1);
        this._updateStatus();
    }

    _resetZones() {
        for (const zone of this._zones) {
            zone.actor.destroy();
            for (const h of zone.handles) h.destroy();
        }
        this._zones = [];
        this._updateStatus();
    }

    _updateStatus() {
        const count = this._zones.length;
        if (this._statusLabel)
            this._statusLabel.text = `${count} ${count === 1 ? _("zone") : _("zones")}`;
    }

    // ------------------------------------------------------------------ private — canvas input

    _onPress(event) {
        const button = event.get_button();

        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._backdrop.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        // Ignore clicks on the toolbar area
        const geom = this._area ?? global.display.get_monitor_geometry(this._monitorIndex);

        if (ly > geom.height - TOOLBAR_HEIGHT)
            return Clutter.EVENT_PROPAGATE;

        // Middle-click to delete a zone (coordinate-based for GNOME 47+ compat)
        if (button === 2) {
            const zone = this._findZoneAt(lx, ly, geom);
            if (zone) {
                this._deleteZone(zone);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (button !== 1) // primary button
            return Clutter.EVENT_PROPAGATE;

        // Check if pressing a handle (coordinate hit-test; event.get_source()
        // was removed in GNOME 47+)
        const handle = this._findHandleAt(lx, ly);
        if (handle) {
            const targetActor = handle._wtcZoneActor;
            const zone = this._zones.find(z => z.actor === targetActor);
            if (zone) {
                this._draggingHandle = {
                    zone,
                    edge: handle._wtcEdge,
                    startX: lx,
                    startY: ly,
                    origRect: { ...zone.normRect },
                };
                return Clutter.EVENT_STOP;
            }
        }

        // Start rubber-band draw anywhere in the canvas area
        this._drawing = true;
        this._drawStart = { x: lx, y: ly };

        this._rubberband = new St.Bin({ style_class: "wtc-editor-rubberband" });
        this._rubberband.set_position(lx, ly);
        this._rubberband.set_size(1, 1);
        this._canvas.add_child(this._rubberband);

        // Hide instructions once user starts drawing
        if (this._instructionLabel) {
            this._instructionLabel.hide();
        }

        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._backdrop.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        const geom = this._area ?? global.display.get_monitor_geometry(this._monitorIndex);

        if (this._drawing && this._rubberband) {
            const x = Math.min(lx, this._drawStart.x);
            const y = Math.min(ly, this._drawStart.y);
            const w = Math.abs(lx - this._drawStart.x);
            const h = Math.abs(ly - this._drawStart.y);
            this._rubberband.set_position(x, y);
            this._rubberband.set_size(Math.max(w, 1), Math.max(h, 1));
            return Clutter.EVENT_STOP;
        }

        if (this._draggingHandle) {
            this._applyHandleDrag(lx, ly, geom);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onRelease(event) {
        if (event.get_button() !== 1) // primary button
            return Clutter.EVENT_PROPAGATE;

        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._backdrop.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        const geom = this._area ?? global.display.get_monitor_geometry(this._monitorIndex);

        if (this._drawing) {
            this._drawing = false;
            if (this._rubberband) {
                const rx = Math.min(lx, this._drawStart.x);
                const ry = Math.min(ly, this._drawStart.y);
                const rw = Math.abs(lx - this._drawStart.x);
                const rh = Math.abs(ly - this._drawStart.y);

                this._rubberband.destroy();
                this._rubberband = null;

                if (rw >= MIN_ZONE_PX && rh >= MIN_ZONE_PX) {
                    const norm = this._snapToGrid({
                        x: rx / geom.width,
                        y: ry / geom.height,
                        w: rw / geom.width,
                        h: rh / geom.height,
                    });
                    this._addZoneActor(norm);
                }
            }
            this._drawStart = null;
            return Clutter.EVENT_STOP;
        }

        if (this._draggingHandle) {
            this._draggingHandle = null;
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _applyHandleDrag(lx, ly, geom) {
        const dh = this._draggingHandle;
        if (!dh) return;

        const zone = dh.zone;
        if (!zone || !this._zones.includes(zone)) return;

        const dx = (lx - dh.startX) / geom.width;
        const dy = (ly - dh.startY) / geom.height;

        const orig = dh.origRect;
        const edge = dh.edge;
        const minW = MIN_ZONE_PX / geom.width;
        const minH = MIN_ZONE_PX / geom.height;

        let { x, y, w, h } = orig;

        // Left/top handles move an edge while the OPPOSITE edge (right/bottom)
        // must stay anchored in place. Clamping x/y alone (as a naive
        // `x += dx; w -= dx` followed by `x = clamp(x)` would do) desyncs w/h
        // from that anchor once the drag overshoots the monitor edge — the
        // fixed edge would visibly jump. Instead, derive the moving edge from
        // the anchor so the opposite edge never moves.
        if (edge.includes("l")) {
            const right = orig.x + orig.w;
            x = Math.max(0, Math.min(orig.x + dx, right - minW));
            w = right - x;
        }
        if (edge.includes("r")) {
            w = Math.max(minW, Math.min(orig.w + dx, 1 - orig.x));
        }
        if (edge.includes("t")) {
            const bottom = orig.y + orig.h;
            y = Math.max(0, Math.min(orig.y + dy, bottom - minH));
            h = bottom - y;
        }
        if (edge.includes("b")) {
            h = Math.max(minH, Math.min(orig.h + dy, 1 - orig.y));
        }

        const snapped = this._snapToGrid({ x, y, w, h });
        zone.normRect = snapped;
        this._updateActorFromNorm(zone.actor, snapped, geom);

        // Update handle positions
        for (const h of zone.handles) h.destroy();
        zone.handles = this._buildHandles(zone.actor, snapped, geom);
        for (const h of zone.handles) this._canvas.add_child(h);
    }

    // ------------------------------------------------------------------ private — grid snap

    /**
     * Find the handle actor at the given local coordinates (backdrop-relative).
     * Replaces event.get_source() which was removed in GNOME 47+.
     * Hit area is padded by HANDLE_PAD so handles are easy to click.
     */
    _findHandleAt(lx, ly) {
        const PAD = 8;
        for (const zone of this._zones) {
            for (const h of zone.handles) {
                const hx = h.x;
                const hy = h.y;
                const hw = h.width || HANDLE_SIZE;
                const hh = h.height || HANDLE_SIZE;
                if (lx >= hx - PAD && lx <= hx + hw + PAD &&
                    ly >= hy - PAD && ly <= hy + hh + PAD)
                    return h;
            }
        }
        return null;
    }

    /**
     * Find the zone entry at the given local coordinates (backdrop-relative).
     */
    _findZoneAt(lx, ly, geom) {
        for (const zone of this._zones) {
            const nr = zone.normRect;
            const zx = nr.x * geom.width;
            const zy = nr.y * geom.height;
            const zw = nr.w * geom.width;
            const zh = nr.h * geom.height;
            if (lx >= zx && lx <= zx + zw && ly >= zy && ly <= zy + zh)
                return zone;
        }
        return null;
    }

    _snapToGrid(normRect) {
        const cols = this._settings.zoneEditorGridColumns;
        const rows = this._settings.zoneEditorGridRows;

        const snap = (v, divisions) => Math.round(v * divisions) / divisions;

        const w = Math.max(snap(normRect.w, cols), 1 / cols);
        const h = Math.max(snap(normRect.h, rows), 1 / rows);

        // x and w (resp. y and h) are snapped independently, so rounding can
        // push x (or y) up to a grid line whose width no longer fits before
        // the right/bottom edge of the monitor (e.g. x snaps to 1.0 while w
        // snaps to a minimum column width, giving x+w > 1). Re-clamp against
        // the snapped size so a zone can never extend past the monitor edge.
        const x = Math.max(0, Math.min(snap(normRect.x, cols), 1 - w));
        const y = Math.max(0, Math.min(snap(normRect.y, rows), 1 - h));

        return { x, y, w, h };
    }

    // ------------------------------------------------------------------ private — save

    _saveZones() {
        const activeZones = this._zones.map(z => z.normRect);

        if (activeZones.length === 0) {
            this._log?.warn("ZoneEditor: cannot save with 0 zones");
            if (this._statusLabel) {
                this._statusLabel.text = _("Draw at least one zone before saving");
                this._statusLabel.add_style_class_name?.("wtc-editor-error");
            }
            // Re-show instructions
            if (this._instructionLabel)
                this._instructionLabel.show();
            return;
        }

        const name = this._nameEntry?.get_text?.()?.trim() ||
                     `${_("Custom")} ${this._customZones.getAll().length + 1}`;

        if (this._editingSetId) {
            this._customZones.updateZoneSet(this._editingSetId, {
                label: name,
                zones: activeZones,
            });
        } else {
            this._customZones.addZoneSet({
                id: this._customZones.generateId(),
                label: name,
                zones: activeZones,
            });
        }

        this._log?.info(`ZoneEditor: saved "${name}" with ${activeZones.length} zones`);
        this.close();
    }
}
