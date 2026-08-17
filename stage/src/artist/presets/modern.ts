import { PeriodicTable } from "../../system/elements";
import { getColorMap } from "../palette";
import type { AtomStyle, BondStyle, Theme } from "../theme";

const ovito = getColorMap("ovito-elements");

export class ModernTheme implements Theme {
  public readonly name = "Modern";

  public readonly backgroundColor = "#1E1E1E";
  public readonly selectionColor = "#89CFF0";
  public readonly boxColor = "#FFFFFF";
  public readonly defaultSpecular = "#888888";

  public getAtomStyle(element: string): AtomStyle {
    const [r, g, b] = ovito.colorForKey(element);
    const toHex = (v: number) => {
      const s = Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.2) * 255);
      return s.toString(16).padStart(2, "0");
    };
    const color = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
    const radius = (PeriodicTable[element]?.radius || 0.3) * 0.8;
    return {
      color,
      radius,
      specularColor: "#FFFFFF",
      emissiveColor: "#000000",
    };
  }

  /**
   * Neutral stand-in only. Type colours come from the generated categorical
   * palette, which needs the whole type set to separate them and so cannot be
   * answered one key at a time here.
   */
  public getTypeStyle(_type: string): AtomStyle {
    return { color: "#B6BDC7", radius: 0.5 };
  }

  public getBondStyle(_order: number, _type?: string): BondStyle {
    return { color: "#BDC3C7", radius: 0.12, specularColor: "#FFFFFF" };
  }
}
