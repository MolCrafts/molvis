import { describe, expect, it } from "@rstest/core";
import { getModifierName, isCtrlOrMeta, isMac } from "../src/platform";

describe("isCtrlOrMeta", () => {
  it("accepts exactly one modifier, matching the platform", () => {
    const ctrlOnly = { ctrlKey: true, metaKey: false };
    const metaOnly = { ctrlKey: false, metaKey: true };
    expect(isCtrlOrMeta(isMac ? metaOnly : ctrlOnly)).toBe(true);
    // Regression: the sketch board used `metaKey || ctrlKey`, which accepts
    // Ctrl on macOS — where Ctrl+click is the secondary-click gesture, so a
    // Ctrl+click fired a context menu *and* a modifier-click.
    expect(isCtrlOrMeta(isMac ? ctrlOnly : metaOnly)).toBe(false);
  });

  it("is false when no modifier is held", () => {
    expect(isCtrlOrMeta({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("names the modifier it actually checks", () => {
    expect(getModifierName()).toBe(isMac ? "Cmd" : "Ctrl");
  });
});
