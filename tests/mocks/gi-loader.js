/**
 * tests/mocks/gi-loader.js
 *
 * Node.js custom ESM loader hook that resolves `gi://…` specifiers and
 * `resource:///…` specifiers to in-process stub modules so the pure-logic
 * source files can be required without a live GNOME Shell session.
 *
 * Stubs are intentionally minimal — they expose only what the src/ modules
 * actually call so misuse is caught at test-time as a missing-property error.
 */

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Build a bare stub object that throws a descriptive error if any property
 * that has NOT been explicitly whitelisted is accessed.
 */
function stub(name, props = {}) {
    return new Proxy(
        { ...props, _stubName: name },
        {
            get(target, key) {
                if (key in target) return target[key];
                if (typeof key === "symbol") return undefined;
                throw new Error(
                    `[GJS mock] ${name}.${String(key)} accessed but not stubbed`
                );
            },
        }
    );
}

// ── GObject (minimal, only registerClass + TYPE_* constants) ─────────────────

const GObjectStub = (() => {
    function registerClass(metaOrClass, maybeClass) {
        // Support both single-arg and two-arg forms
        const klass = maybeClass ?? metaOrClass;
        return klass;
    }

    const TYPE_STRING  = "gchararray";
    const TYPE_INT     = "gint";
    const TYPE_UINT    = "guint";
    const TYPE_BOOLEAN = "gboolean";
    const TYPE_POINTER = "gpointer";
    const TYPE_DOUBLE  = "gdouble";

    class ObjectBase {
        constructor(...args) {
            this._signalHandlers = new Map();
            // In real GObject, the constructor calls _init().
            // Replicate that so subclasses initialise their fields.
            if (typeof this._init === "function")
                this._init(...args);
        }
        _init() {}
        connect(signal, cb) {
            if (!this._signalHandlers.has(signal)) this._signalHandlers.set(signal, []);
            const id = Math.random();
            this._signalHandlers.get(signal).push({ id, cb });
            return id;
        }
        disconnect(id) {
            for (const [sig, cbs] of this._signalHandlers)
                this._signalHandlers.set(sig, cbs.filter(h => h.id !== id));
        }
        emit(signal, ...args) {
            const handlers = this._signalHandlers.get(signal) ?? [];
            for (const { cb } of handlers) cb(this, ...args);
        }
    }

    return {
        registerClass,
        TYPE_STRING, TYPE_INT, TYPE_UINT, TYPE_BOOLEAN, TYPE_POINTER, TYPE_DOUBLE,
        Object: ObjectBase,
        ParamSpec: { string: () => ({}), boolean: () => ({}), uint: () => ({}) },
    };
})();

// ── GLib (timeout/idle stubs, PRIORITY_DEFAULT, SOURCE_REMOVE) ───────────────

const GLibStub = (() => {
    const PRIORITY_DEFAULT = 0;
    const PRIORITY_DEFAULT_IDLE = 200;
    const SOURCE_REMOVE = false;
    const SOURCE_CONTINUE = true;

    /** Synchronously invoke the callback once and return SOURCE_REMOVE. */
    function timeout_add(_priority, _ms, cb) {
        Promise.resolve().then(() => cb());
        return 1;
    }

    function idle_add(_priority, cb) {
        Promise.resolve().then(() => cb());
        return 1;
    }

    const Source = { remove: (_id) => {} };

    const get_monotonic_time = () => Date.now() * 1000;

    return { PRIORITY_DEFAULT, PRIORITY_DEFAULT_IDLE, SOURCE_REMOVE, SOURCE_CONTINUE, timeout_add, idle_add, Source, get_monotonic_time };
})();

// ── Meta.Rectangle (pure data class used extensively) ────────────────────────

class MetaRectangle {
    constructor({ x = 0, y = 0, width = 0, height = 0 } = {}) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
}

const MetaStub = {
    Rectangle: MetaRectangle,
    MaximizeFlags: { BOTH: 3, HORIZONTAL: 1, VERTICAL: 2 },
    KeyBindingFlags: { NONE: 0, IS_REVERSED: 1 },
    GrabOp: { MOVING: 1 },
    DisplayDirection: { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3 },
    WindowType: {
        NORMAL: 0, DESKTOP: 1, DOCK: 2, DIALOG: 3, MODAL_DIALOG: 4,
        TOOLBAR: 5, MENU: 6, UTILITY: 7, SPLASHSCREEN: 8,
        DROPDOWN_MENU: 9, POPUP_MENU: 10, TOOLTIP: 11, NOTIFICATION: 12,
        COMBO: 13, DND: 14, OVERRIDE_OTHER: 15,
    },
};

// ── Gio (SettingsBindFlags only — no real GSettings needed in tests) ──────────

const GioStub = {
    SettingsBindFlags: { DEFAULT: 0, GET: 1, SET: 2, NO_SENSITIVITY: 3 },
};

// ── Clutter (AnimationMode, ActorAlign) ───────────────────────────────────────

const ClutterStub = {
    AnimationMode: { EASE_OUT_CUBIC: 3, LINEAR: 1 },
    ActorAlign: { CENTER: 0, START: 1, END: 2, FILL: 3 },
    EventType: {
        BUTTON_PRESS: 1, MOTION: 2, BUTTON_RELEASE: 3,
        KEY_PRESS: 4, KEY_RELEASE: 5,
    },
    ModifierType: { SHIFT_MASK: 1 },
    ShaderType: { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2 },
    ShaderEffect: class ShaderEffect {
        constructor(props = {}) { Object.assign(this, props); this._uniforms = {}; }
        set_shader_source(src) { this._shaderSource = src; }
        set_uniform_value(name, value) { this._uniforms[name] = value; }
    },
    EVENT_STOP: true,
    EVENT_PROPAGATE: false,
};

// ── St (UI widget constructors) ──────────────────────────────────────────────
// Hand-coded source string so the generated ESM contains real classes that
// tests (and source code) can instantiate via `new St.Bin(...)` etc.

const ST_MODULE_SOURCE = `
class _StBase {
    constructor(props = {}) {
        this._children = [];
        this.opacity = 255;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.visible = true;
        this.reactive = false;
        this.can_focus = false;
        this.track_hover = false;
        this.style_class = "";
        this._signalHandlers = {};
        Object.assign(this, props);
    }
    add_child(c) { this._children.push(c); }
    remove_child(c) { this._children = this._children.filter(x => x !== c); }
    remove_all_children() { this._children = []; }
    destroy() { this._children = []; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    get_transformed_position() { return [this.x, this.y]; }
    connect(signal, cb) {
        if (!this._signalHandlers[signal]) this._signalHandlers[signal] = [];
        const id = Math.random();
        this._signalHandlers[signal].push({ id, cb });
        return id;
    }
    disconnect(id) {
        for (const [sig, cbs] of Object.entries(this._signalHandlers))
            this._signalHandlers[sig] = cbs.filter(h => h.id !== id);
    }
    emit(signal, ...args) {
        (this._signalHandlers[signal] ?? []).forEach(({ cb }) => cb(this, ...args));
    }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    grab_key_focus() {}
    ensure_style() {}
    contains(c) { return this._children.includes(c); }
    ease(params) {
        if (params.opacity !== undefined) this.opacity = params.opacity;
        if (params.x !== undefined) this.x = params.x;
        if (params.y !== undefined) this.y = params.y;
        if (params.width !== undefined) this.width = params.width;
        if (params.height !== undefined) this.height = params.height;
        if (params.onComplete) params.onComplete();
    }
    set_child(c) { this._children = [c]; }
}

export class Bin extends _StBase {}
export class BoxLayout extends _StBase {}
export class Button extends _StBase {}
export class Label extends _StBase {
    get_text() { return this.text ?? ""; }
}
export class Entry extends _StBase {
    get_text() { return this.text ?? ""; }
}
export class Icon extends _StBase {}
export class Widget extends _StBase {}
export class ScrollView extends _StBase {}

export default { Bin, BoxLayout, Button, Label, Entry, Icon, Widget, ScrollView };
`;

// ── Main (mutable live bindings via let + globalThis setter) ─────────────────
// Tests need to replace Main.wm, Main.uiGroup etc. ESM namespace properties
// are read-only, so we use let bindings + a globalThis setter function that
// updates them from inside the module.

const MAIN_MODULE_SOURCE = `
let panel = {};
let overview = {};
let sessionMode = {};
let wm = {};
let extensionManager = {};
let uiGroup = {};

// pushModal/popModal: real GNOME Shell returns a grab handle with a
// dismiss() method; tests can override the implementation (e.g. to
// simulate a failed grab) via globalThis.__wtcMainSet__("pushModal", fn).
let pushModal = (actor, params) => ({ actor, params, dismiss() {} });
let popModal = (_grab) => {};

globalThis.__wtcMainSet__ = function _setMain(prop, value) {
    switch (prop) {
        case "panel": panel = value; break;
        case "overview": overview = value; break;
        case "sessionMode": sessionMode = value; break;
        case "wm": wm = value; break;
        case "extensionManager": extensionManager = value; break;
        case "uiGroup": uiGroup = value; break;
        case "pushModal": pushModal = value; break;
        case "popModal": popModal = value; break;
    }
};

export { panel, overview, sessionMode, wm, extensionManager, uiGroup, pushModal, popModal };
export default { panel, overview, sessionMode, wm, extensionManager, uiGroup, pushModal, popModal };
`;

// ── Mapping from specifier → stub module ─────────────────────────────────────

// Specifiers that have hand-crafted module source (not auto-serialized)
const HARDCODED_SOURCES = new Map([
    ["gi://St",                                          ST_MODULE_SOURCE],
    ["resource:///org/gnome/shell/ui/main.js",           MAIN_MODULE_SOURCE],
]);

const STUBS = new Map([
    ["gi://GObject",  GObjectStub],
    ["gi://GLib",     GLibStub],
    ["gi://Meta",     MetaStub],
    ["gi://Mtk",      { Rectangle: MetaRectangle }],
    ["gi://Gio",      GioStub],
    ["gi://Clutter",  ClutterStub],
    ["gi://Shell",    { ActionMode: { NORMAL: 1, OVERVIEW: 2, ALL: 0xFFFFFFFF }, WindowTracker: { get_default: () => ({ get_window_app: () => null }) } }],
    ["gi://Adw",      {}],
    ["gi://Gtk",      {}],
    ["gi://Gdk",      {}],
]);

// resource:/// imports (GNOME Shell UI) → empty stubs
const RESOURCE_STUBS = new Map([
    ["resource:///org/gnome/shell/ui/quickSettings.js",     {}],
    ["resource:///org/gnome/shell/ui/popupMenu.js",         {}],
    ["resource:///org/gnome/shell/extensions/extension.js", { Extension: class Extension {} }],
    ["resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js", { ExtensionPreferences: class ExtensionPreferences {} }],
]);

// Relative stubs: local src/ files that import gi:// internally
// (handled transparently by the loader; only the top-level gi:// are stubbed)

// ── Node.js ESM loader hooks ─────────────────────────────────────────────────

const STUB_SCHEME = "node:wtc-stub:";

/**
 * Serialize a stub value into embeddable ES module source code.
 * Functions and classes are serialized via .toString() so they remain
 * self-contained in the generated module that runs in a different thread.
 */
function serializeValue(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "boolean" || t === "number") return JSON.stringify(v);
    if (t === "string") return JSON.stringify(v);
    if (t === "function") return v.toString();
    if (Array.isArray(v)) return `[${v.map(serializeValue).join(", ")}]`;
    if (t === "object") {
        const entries = Object.entries(v).map(([k, val]) => {
            const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
            return `${key}: ${serializeValue(val)}`;
        });
        return `{ ${entries.join(", ")} }`;
    }
    return "undefined";
}

export function resolve(specifier, context, nextResolve) {
    if (HARDCODED_SOURCES.has(specifier) || STUBS.has(specifier) || RESOURCE_STUBS.has(specifier)) {
        return { url: `${STUB_SCHEME}${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
        const specifier = decodeURIComponent(url.slice(STUB_SCHEME.length));

        // Hand-crafted modules (St, Main) — return pre-built source directly
        if (HARDCODED_SOURCES.has(specifier)) {
            return { format: "module", source: HARDCODED_SOURCES.get(specifier), shortCircuit: true };
        }

        const stubObj = STUBS.get(specifier) ?? RESOURCE_STUBS.get(specifier) ?? {};

        // Serialize each stub value inline so the generated module is fully
        // self-contained — no cross-thread globalThis references needed.
        const keys = Object.keys(stubObj);
        const namedExports = keys
            .map(k => `export const ${k} = ${serializeValue(stubObj[k])};`)
            .join("\n");
        const defaultExport = keys.length > 0
            ? `export default { ${keys.join(", ")} };`
            : `export default {};`;

        return { format: "module", source: `${namedExports}\n${defaultExport}`, shortCircuit: true };
    }
    return nextLoad(url, context);
}
