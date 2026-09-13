/**
 * Window Tiling Control — src/layoutPresets.js
 * 8 built-in zone presets defined as normalized {x, y, w, h} rectangles (0.0-1.0).
 *
 * minAspectRatio: preset is only offered when monitor w/h >= this value.
 *   undefined = always available
 *   2.1       = ultra-wide only
 *   < 0.8     = portrait only (tracked via separate `portraitOnly` flag)
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} NormRect */
/** @typedef {{ id: string, label: string, minAspectRatio?: number, portraitOnly?: boolean, zones: NormRect[] }} Preset */

/** @type {Preset[]} */
export const PRESETS = [
    {
        id: "halves",
        label: "Halves",
        zones: [
            { x: 0,   y: 0, w: 0.5, h: 1 },
            { x: 0.5, y: 0, w: 0.5, h: 1 },
        ],
    },
    {
        id: "thirds",
        label: "Thirds",
        minAspectRatio: 1.3,
        zones: [
            { x: 0,         y: 0, w: 1/3, h: 1 },
            { x: 1/3,       y: 0, w: 1/3, h: 1 },
            { x: 2/3,       y: 0, w: 1/3, h: 1 },
        ],
    },
    {
        id: "wide-left",
        label: "Wide Left",
        zones: [
            { x: 0,   y: 0, w: 2/3, h: 1 },
            { x: 2/3, y: 0, w: 1/3, h: 1 },
        ],
    },
    {
        id: "wide-right",
        label: "Wide Right",
        zones: [
            { x: 0,   y: 0, w: 1/3, h: 1 },
            { x: 1/3, y: 0, w: 2/3, h: 1 },
        ],
    },
    {
        id: "quarters",
        label: "Quarters",
        zones: [
            { x: 0,   y: 0,   w: 0.5, h: 0.5 },
            { x: 0.5, y: 0,   w: 0.5, h: 0.5 },
            { x: 0,   y: 0.5, w: 0.5, h: 0.5 },
            { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        ],
    },
    {
        id: "half-quarters",
        label: "Half + Quarters",
        zones: [
            { x: 0,   y: 0,   w: 0.5, h: 1   },
            { x: 0.5, y: 0,   w: 0.5, h: 0.5 },
            { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        ],
    },
    {
        id: "sixths",
        label: "Sixths",
        minAspectRatio: 2.1,
        zones: [
            { x: 0,     y: 0,   w: 1/3, h: 0.5 },
            { x: 1/3,   y: 0,   w: 1/3, h: 0.5 },
            { x: 2/3,   y: 0,   w: 1/3, h: 0.5 },
            { x: 0,     y: 0.5, w: 1/3, h: 0.5 },
            { x: 1/3,   y: 0.5, w: 1/3, h: 0.5 },
            { x: 2/3,   y: 0.5, w: 1/3, h: 0.5 },
        ],
    },
    {
        id: "top-thirds",
        label: "Top Thirds",
        portraitOnly: true,
        zones: [
            { x: 0,   y: 0, w: 0.5, h: 0.5 },
            { x: 0.5, y: 0, w: 0.5, h: 0.5 },
            { x: 0,   y: 0.5, w: 1,  h: 0.5 },
        ],
    },
];

/**
 * Return the subset of built-in presets appropriate for a given aspect ratio.
 *
 * @param {number} aspectRatio  monitorWidth / monitorHeight
 * @returns {Preset[]}
 */
export function getPresetsForAspectRatio(aspectRatio) {
    const isPortrait = aspectRatio < 0.8;

    return PRESETS.filter(p => {
        // Portrait-only presets (e.g. "top-thirds") only make sense on tall
        // monitors — hide them everywhere else, ultra-wide included.
        if (p.portraitOnly && !isPortrait) return false;
        if (p.minAspectRatio && aspectRatio < p.minAspectRatio) return false;
        return true;
    });
}

/**
 * Look up a built-in preset by id.
 * @param {string} id
 * @returns {Preset|undefined}
 */
export function getPresetById(id) {
    return PRESETS.find(p => p.id === id);
}
