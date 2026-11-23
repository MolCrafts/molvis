import { expect, it } from "@rstest/core";
import {
  findVisualPreset,
  VISUAL_PRESETS,
} from "../../src/artist/visual_preset";

it("separates flat geometry from shading and preserves all legacy look policies", () => {
  expect(VISUAL_PRESETS).toHaveLength(10);
  const flat = findVisualPreset("flat");
  expect(flat.representation.id).toBe("ball-and-stick");
  expect(flat.atomMaterial.shading).toBe("flat");
  expect(flat.outline).toEqual({
    outlineEnabled: true,
    atomOutline: 0.12,
    bondOutline: 0.2,
  });
  expect(findVisualPreset("metal-tube").representation.atomVisibility).toBe(
    "metal-tube-joints",
  );
  expect(findVisualPreset("metal-tube").atomMaterial.shading).toBe(
    "illustrative",
  );
  expect(findVisualPreset("spacefill").outline.outlineEnabled).toBe(false);
  expect(findVisualPreset("skeletal").bondColorMode).toBe("theme");
});
