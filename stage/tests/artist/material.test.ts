import { describe, expect, it } from "@rstest/core";
import { Material } from "../../src/artist/material";

describe("Material", () => {
  it("expands a preset with explicit overrides into a frozen value", () => {
    const value = new Material({ preset: "glossy", specular: 0.2 });
    expect(value).toEqual({ shading: "lit", specular: 0.2, specularPower: 32 });
    expect(Object.isFrozen(value)).toBe(true);
    expect(new Material({ preset: "glossy" }).specular).toBe(0.35);
  });
  it("rejects incomplete, unknown and nonfinite parameters", () => {
    for (const input of [
      null,
      [],
      { preset: "glass" },
      { preset: "matte", metalness: 1 },
      { shading: "lit" },
      { preset: "glossy", specular: -1 },
      { preset: "glossy", specularPower: NaN },
      { preset: "glossy", specular: Infinity },
      { preset: "matte", shading: "pbr" },
    ]) {
      expect(() => new Material(input)).toThrow();
    }
    expect(() => Material.target("atoms")).toThrow(/target/);
  });
});
