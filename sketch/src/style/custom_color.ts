import { SKETCH_TOKEN_DEFAULTS } from "./tokens";

/** Default color shown by the custom-color picker (`--msk-custom-default`). */
export const DEFAULT_CUSTOM_COLOR = SKETCH_TOKEN_DEFAULTS.customDefault;

/** Return a normalized six-digit CSS hex color or throw. */
export function normalizeSketchColor(color: string): string {
  const normalized = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error(
      `sketch color must be a six-digit CSS hex value; got ${color}`,
    );
  }
  return normalized;
}
