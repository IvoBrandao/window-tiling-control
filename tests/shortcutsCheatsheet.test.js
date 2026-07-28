/**
 * tests/shortcutsCheatsheet.test.js
 * Tests for the pure accelerator-prettifier used by the cheat sheet.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prettifyAccel } from "../src/shortcutsCheatsheet.js";

describe("prettifyAccel", () => {
    it("formats modifiers and arrow keys", () => {
        assert.equal(prettifyAccel("<Super>Left"), "Super + ←");
        assert.equal(prettifyAccel("<Super><Shift>Down"), "Super + Shift + ↓");
        assert.equal(prettifyAccel("<Super><Alt>Right"), "Super + Alt + →");
    });
    it("uppercases single letters", () => {
        assert.equal(prettifyAccel("<Super>k"), "Super + K");
        assert.equal(prettifyAccel("<Super>z"), "Super + Z");
    });
    it("maps named punctuation and Primary→Ctrl", () => {
        assert.equal(prettifyAccel("<Super>slash"), "Super + /");
        assert.equal(prettifyAccel("<Super>bracketright"), "Super + ]");
        assert.equal(prettifyAccel("<Super><Primary>Left"), "Super + Ctrl + ←");
    });
    it("handles Tab", () => {
        assert.equal(prettifyAccel("<Super>Tab"), "Super + Tab");
    });
});
