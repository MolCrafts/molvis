/**
 * Documents that graphics.ssao is part of GraphicsConfig and default off.
 * Full Babylon pipeline attach is covered by integration when a scene exists.
 */
import { describe, expect, it } from "@rstest/core";
import { DEFAULT_SETTING } from "../../src/settings";

describe("SSAO graphics setting", () => {
  it("defaults to false in DEFAULT_SETTING", () => {
    expect(DEFAULT_SETTING.graphics.ssao).toBe(false);
  });

  it("fxaa still defaults true", () => {
    expect(DEFAULT_SETTING.graphics.fxaa).toBe(true);
  });
});
