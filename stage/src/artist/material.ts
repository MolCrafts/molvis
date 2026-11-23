/** Surface response, independent of geometry, data color and scene lighting. */
export type ShadingMode = "lit" | "illustrative" | "flat";
export type MaterialTarget = "atom" | "bond";
export interface MaterialStyle {
  readonly shading: ShadingMode;
  readonly specular: number;
  readonly specularPower: number;
}

export const MATERIAL_PRESETS = Object.freeze({
  matte: Object.freeze({ shading: "lit", specular: 0, specularPower: 4 }),
  glossy: Object.freeze({ shading: "lit", specular: 0.35, specularPower: 32 }),
  illustrative: Object.freeze({
    shading: "illustrative",
    specular: 0,
    specularPower: 4,
  }),
  unlit: Object.freeze({ shading: "flat", specular: 0, specularPower: 4 }),
} satisfies Record<string, MaterialStyle>);
export type MaterialPresetId = keyof typeof MATERIAL_PRESETS;
export type MaterialInput =
  | MaterialStyle
  | ({ preset: MaterialPresetId } & Partial<MaterialStyle>);

/** Resolves preset inputs to immutable, validated material values. */
export class Material implements MaterialStyle {
  readonly shading: ShadingMode;
  readonly specular: number;
  readonly specularPower: number;
  static target(value: unknown): MaterialTarget {
    if (value !== "atom" && value !== "bond")
      throw new Error("Material target must be 'atom' or 'bond'");
    return value;
  }

  constructor(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Material must be an object");
    const value = input as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (!["preset", "shading", "specular", "specularPower"].includes(key))
        throw new Error(`Unknown material parameter '${key}'`);
    }
    let preset: MaterialStyle | undefined;
    if ("preset" in value) {
      if (
        typeof value.preset !== "string" ||
        !Object.hasOwn(MATERIAL_PRESETS, value.preset)
      )
        throw new Error(`Unknown material preset '${String(value.preset)}'`);
      preset = MATERIAL_PRESETS[value.preset as MaterialPresetId];
    }
    const resolved = { ...preset, ...value };
    if (
      resolved.shading !== "lit" &&
      resolved.shading !== "illustrative" &&
      resolved.shading !== "flat"
    )
      throw new Error("Material shading must be lit, illustrative or flat");
    for (const key of ["specular", "specularPower"] as const) {
      if (
        typeof resolved[key] !== "number" ||
        !Number.isFinite(resolved[key]) ||
        resolved[key] < 0
      )
        throw new Error(`Material ${key} must be finite and non-negative`);
    }
    this.shading = resolved.shading;
    this.specular = resolved.specular as number;
    this.specularPower = resolved.specularPower as number;
    Object.freeze(this);
  }
}
