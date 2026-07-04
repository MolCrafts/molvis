import { PeriodicTable } from "../../system/elements";
import { DEFAULT_CATEGORICAL_COLOR_MAP, getColorMap } from "../palette";
import type { AtomStyle, BondStyle, Theme } from "../theme";

const vivid = getColorMap("vivid");
const categorical = getColorMap(DEFAULT_CATEGORICAL_COLOR_MAP);

/**
 * VividTheme — the default look. Same structure as ClassicTheme but backed by
 * the brighter, softened `vivid` element palette so molecules read lively
 * against a dark canvas without the colors turning harsh. Classic (literal
 * CPK) and Modern (Ovito) remain available unchanged.
 */
export class VividTheme implements Theme {
  public readonly name = "Vivid";

  // Decorative — the scene clear color is owned by the viewport, not the theme.
  public readonly backgroundColor = "#0E1116";
  public readonly selectionColor = "#7FE7FF";
  public readonly defaultSpecular = "#5A5A5A";
  public readonly boxColor = "#D6DCE6";

  public getAtomStyle(element: string): AtomStyle {
    const [r, g, b] = vivid.colorForKey(element);
    const color = linearToGammaHex(r, g, b);
    const radius = PeriodicTable[element]?.radius || 0.3;
    return { color, radius };
  }

  public getTypeStyle(type: string): AtomStyle {
    const [r, g, b] = categorical.colorForKey(type);
    return { color: linearToGammaHex(r, g, b), radius: 0.5 };
  }

  public getBondStyle(_order: number, _type?: string): BondStyle {
    // A touch lighter than Classic's #808080 so the stick framework reads as
    // bright neutral rather than muddy grey.
    return { color: "#AEB4BE", radius: 0.1 };
  }
}

/** Convert a linear-RGB triplet (as stored by the palette ColorMap) to a
 *  gamma-encoded `#RRGGBB` string, matching ClassicTheme's conversion. */
function linearToGammaHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => {
    const s = Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.2) * 255);
    return s.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
