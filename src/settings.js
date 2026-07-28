/**
 * WindowTilingControl — src/settings.js
 * Typed GSettings accessors for main and keybindings schemas.
 */

const MAIN_SCHEMA = "org.gnome.shell.extensions.window-tiling-control";
const KB_SCHEMA = "org.gnome.shell.extensions.window-tiling-control.keybindings";

export class Settings {
    constructor(extension) {
        this._settings = extension.getSettings(MAIN_SCHEMA);
        this._kbSettings = extension.getSettings(KB_SCHEMA);
    }

    /**
     * Read a key defensively. If the *installed* compiled schema is older than
     * the code (e.g. the user ran `make enable` without re-running `make
     * install` after a schema change), the key may be absent — reading it would
     * throw. Fall back to the supplied default instead of crashing.
     */
    _get(kind, key, fallback) {
        try {
            if (!this._settings.settings_schema?.has_key(key)) return fallback;
            return this._settings[`get_${kind}`](key);
        } catch (_) {
            return fallback;
        }
    }

    // ------------------------------------------------------------------ main

    get enabled() { return this._settings.get_boolean("tiling-enabled"); }
    set enabled(v) { this._settings.set_boolean("tiling-enabled", v); }

    get snapOverlayEnabled() { return this._settings.get_boolean("snap-overlay-enabled"); }
    get snapAssistEnabled() { return this._settings.get_boolean("snap-assist-enabled"); }
    get dragHighlightEnabled() { return this._settings.get_boolean("drag-zone-highlight-enabled"); }
    get snapGroupsEnabled() { return this._settings.get_boolean("snap-groups-enabled"); }
    get persistSnapGroups() { return this._get("boolean", "persist-snap-groups", false); }

    get snapGroupMemory() { return this._get("strv", "snap-group-memory", []); }
    set snapGroupMemory(v) {
        try { this._settings.set_strv("snap-group-memory", v); } catch (_) {}
    }

    get animationsEnabled() { return this._get("boolean", "animations-enabled", true); }

    get windowGapSize() { return this._settings.get_uint("window-gap-size"); }
    /** Outer (screen-edge) gap. 0 means "follow the inner gap". */
    get outerGapSize() {
        const o = this._get("uint", "outer-gap-size", 0);
        return o > 0 ? o : this.windowGapSize;
    }
    get dragEdgeThreshold() { return this._settings.get_uint("drag-edge-threshold"); }
    get snapAssistTimeout() { return this._settings.get_uint("snap-assist-timeout"); }
    get animationSpeed() { return this._settings.get_uint("animation-speed"); }

    get overlayPosition() { return this._settings.get_string("overlay-position"); }
    get useAccentColor() { return this._get("boolean", "use-accent-color", true); }
    get zoneHighlightColor() { return this._settings.get_string("zone-highlight-color"); }
    get zoneBorderColor() { return this._settings.get_string("zone-border-color"); }

    get customZoneSets() { return this._settings.get_strv("custom-zone-sets"); }
    set customZoneSets(v) { this._settings.set_strv("custom-zone-sets", v); }

    get monitorPresets() { return this._settings.get_strv("monitor-presets"); }
    set monitorPresets(v) { this._settings.set_strv("monitor-presets", v); }

    get zoneEditorGridColumns() { return this._settings.get_uint("zone-editor-grid-columns"); }
    get zoneEditorGridRows() { return this._settings.get_uint("zone-editor-grid-rows"); }

    get logLevel() { return this._settings.get_uint("log-level"); }

    get roundedCornersEnabled() { return this._get("boolean", "rounded-corners-enabled", false); }
    get roundedCornersRadius() { return this._get("uint", "rounded-corners-radius", 12); }

    // ------------------------------------------------------------------ bind helpers

    /**
     * Bind a GSettings key to an object property.
     * Returns the binding for optional later unbinding.
     */
    bind(key, object, property, flags) {
        return this._settings.bind(key, object, property, flags);
    }

    bindKb(key, object, property, flags) {
        return this._kbSettings.bind(key, object, property, flags);
    }

    /**
     * Connect to main settings changes.
     * @returns signal ID
     */
    connect(signal, callback) {
        return this._settings.connect(signal, callback);
    }

    disconnect(id) {
        this._settings.disconnect(id);
    }

    // ------------------------------------------------------------------ keybindings

    get kbSettings() { return this._kbSettings; }

    getKeybinding(key) { return this._kbSettings.get_strv(key); }
    setKeybinding(key, value) { this._kbSettings.set_strv(key, value); }

    connectKb(signal, callback) {
        return this._kbSettings.connect(signal, callback);
    }

    disconnectKb(id) {
        this._kbSettings.disconnect(id);
    }

    // ------------------------------------------------------------------ raw access (for binding in prefs)

    get raw() { return this._settings; }
}
