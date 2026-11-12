import { describe, expect, it } from "@rstest/core";
import { defaultLabelColor } from "../../src/overlays/mark_atom";

describe("defaultLabelColor", () => {
  it("is dark on a light background and light on a dark one", () => {
    expect(defaultLabelColor({ r: 1, g: 1, b: 1 })).toBe("#1A1A1A");
    expect(defaultLabelColor({ r: 0.05, g: 0.05, b: 0.08 })).toBe("#FFFFFF");
  });
});
