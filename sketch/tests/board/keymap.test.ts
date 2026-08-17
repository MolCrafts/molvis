import { isMac } from "@molcrafts/molvis-core/platform";
import { describe, expect, it } from "@rstest/core";
import { resolveKeymap } from "../../src/board/keymap";

/** The platform's primary modifier, and the one that must be ignored. */
const mod = isMac ? { metaKey: true } : { ctrlKey: true };
const wrongMod = isMac ? { ctrlKey: true } : { metaKey: true };

describe("resolveKeymap", () => {
  it("maps undo redo delete escape bond order elements", () => {
    expect(resolveKeymap({ key: "z", ...mod })).toEqual({ type: "undo" });
    expect(resolveKeymap({ key: "z", ...mod, shiftKey: true })).toEqual({
      type: "redo",
    });
    expect(resolveKeymap({ key: "y", ...mod })).toEqual({ type: "redo" });
    expect(resolveKeymap({ key: "Delete" })).toEqual({ type: "delete" });
    expect(resolveKeymap({ key: "Escape" })).toEqual({ type: "cancel" });
    expect(resolveKeymap({ key: "1" })).toEqual({
      type: "bondOrder",
      order: 1,
    });
    expect(resolveKeymap({ key: "c" })).toEqual({
      type: "element",
      symbol: "C",
    });
    expect(resolveKeymap({ key: "b" })).toEqual({
      type: "element",
      symbol: "B",
    });
    expect(resolveKeymap({ key: "t" })).toBeNull();
  });

  it("ignores the other platform's modifier", () => {
    // Regression: this file used to assert that *both* Meta and Ctrl
    // trigger undo/redo, which is what the board's own
    // `metaKey || ctrlKey` check did. On macOS that makes Ctrl+Z a
    // shortcut even though Ctrl there is the secondary-click modifier.
    expect(resolveKeymap({ key: "z", ...wrongMod })).toBeNull();
    expect(resolveKeymap({ key: "y", ...wrongMod })).toBeNull();
  });
});
