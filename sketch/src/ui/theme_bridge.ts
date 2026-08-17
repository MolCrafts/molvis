import type { SketchRenderTheme } from "../board/sketch_renderer";
import {
  CANVAS_THEME_FROM_CSS,
  defaultCanvasTheme,
  SKETCH_CSS_VARS,
  SKETCH_TOKEN_DEFAULTS,
} from "../style/tokens";

/**
 * Resolve a CSS custom property on `host` to a concrete color string that
 * Canvas 2D can paint (rgb/oklab/…). Custom properties often hold
 * `var(--…)` / `oklch(…)` tokens; the canvas API does not expand those.
 */
export function resolveCssColor(
  host: HTMLElement,
  property: string,
  fallback: string,
): string {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return fallback;
  }
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;color:var(" +
    property +
    ")";
  host.appendChild(probe);
  const color = getComputedStyle(probe).color.trim();
  probe.remove();
  return color || fallback;
}

/**
 * Convert a computed CSS color (`rgb(…)`, `#rrggbb`, …) to `#rrggbb`.
 * Used for `<input type="color">` which only accepts hex.
 */
export function cssColorToHex(color: string): string | null {
  const trimmed = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const m = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/,
  );
  if (!m) return null;
  const toByte = (v: string) =>
    Math.max(0, Math.min(255, Math.round(Number(v))))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(m[1])}${toByte(m[2])}${toByte(m[3])}`;
}

/**
 * Full canvas theme from `--msk-*` chrome tokens (same set page bridges).
 * Call after the composer root is in the document so host overrides apply.
 */
export function readCanvasThemeFromHost(
  host: HTMLElement,
  fallback: SketchRenderTheme = defaultCanvasTheme(),
): SketchRenderTheme {
  return {
    background: resolveCssColor(
      host,
      CANVAS_THEME_FROM_CSS.background,
      fallback.background,
    ),
    bondStroke: resolveCssColor(
      host,
      CANVAS_THEME_FROM_CSS.bondStroke,
      fallback.bondStroke,
    ),
    labelFill: resolveCssColor(
      host,
      CANVAS_THEME_FROM_CSS.labelFill,
      fallback.labelFill,
    ),
    selectionStroke: resolveCssColor(
      host,
      CANVAS_THEME_FROM_CSS.selectionStroke,
      fallback.selectionStroke,
    ),
  };
}

/**
 * Default for the custom-color picker.
 * Prefers `--msk-custom-default` when it is already `#rrggbb`; otherwise
 * derives hex from resolved `--msk-active-ink` so product accent stays one token.
 */
export function readCustomDefaultFromHost(
  host: HTMLElement,
  fallback: string = SKETCH_TOKEN_DEFAULTS.customDefault,
): string {
  if (typeof getComputedStyle !== "undefined") {
    const raw = getComputedStyle(host)
      .getPropertyValue(SKETCH_CSS_VARS.customDefault)
      .trim()
      .toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  }
  const accent = resolveCssColor(host, SKETCH_CSS_VARS.activeInk, fallback);
  return cssColorToHex(accent) ?? fallback;
}
