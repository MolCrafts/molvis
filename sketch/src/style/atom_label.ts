import type { Atom2D } from "../types";

interface Point {
  x: number;
  y: number;
}

/** One piece of text in an atom label, positioned relative to the atom. */
export interface LabelRun {
  text: string;
  /** Horizontal offset of the run's anchor from the atom, in px. */
  dx: number;
  /** Vertical offset (screen y-down) of the run's middle, in px. */
  dy: number;
  /** Font size in px. */
  size: number;
  weight: 500 | 600;
  anchor: "start" | "middle";
  /** `element` and `hydrogen` runs take the element color; `charge` the label fill. */
  role: "element" | "hydrogen" | "charge";
}

/**
 * Approximate advance of bold Helvetica/Arial glyphs, as a fraction of the
 * font size. Labels are laid out without a text-measuring context (the SVG
 * export also runs in Node), so widths come from these classes.
 */
const ADVANCE = { upper: 0.74, lower: 0.42, digit: 0.56 } as const;

/** Approximate rendered width of `text` at `size` px. */
function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") em += ADVANCE.digit;
    else if (ch === ch.toLowerCase() && ch !== ch.toUpperCase())
      em += ADVANCE.lower;
    else em += ADVANCE.upper;
  }
  return em * size;
}

/**
 * Text layout of one atom's label, shared by the canvas renderer and the SVG
 * exporter so both draw the same thing: the element symbol centred on the
 * atom, implicit hydrogens (`OH`, `H₂N`) on the side away from the bonds,
 * and the formal charge as a superscript after the last run.
 *
 * Coordinates are screen pixels, y down. `neighbors` are the screen positions
 * of the bonded atoms; they decide which side the hydrogens and a port
 * marker go on.
 */
export class AtomLabel {
  /** Unit vector pointing away from the bonds (straight up when isolated). */
  readonly freeDirection: Point;
  private readonly hydrogensLeft: boolean;

  constructor(
    private readonly atom: Atom2D,
    origin: Point,
    neighbors: readonly Point[],
  ) {
    let sx = 0;
    let sy = 0;
    for (const p of neighbors) {
      const length = Math.hypot(p.x - origin.x, p.y - origin.y) || 1;
      sx += (p.x - origin.x) / length;
      sy += (p.y - origin.y) / length;
    }
    const length = Math.hypot(sx, sy);
    this.freeDirection =
      length < 1e-6 ? { x: 0, y: -1 } : { x: -sx / length, y: -sy / length };
    // Bonds mostly to the right → hydrogens read right-to-left (`HO–`).
    this.hydrogensLeft = neighbors.length > 0 && sx > 0.25;
  }

  /** Whether the label carries implicit hydrogens. */
  get hasHydrogens(): boolean {
    return (this.atom.hydrogens ?? 0) > 0;
  }

  /** Text runs for a label at `fontPx`. */
  runs(fontPx: number): LabelRun[] {
    const elementHalf = textWidth(this.atom.element, fontPx) / 2;
    const out: LabelRun[] = [
      {
        text: this.atom.element,
        dx: 0,
        dy: 0,
        size: fontPx,
        weight: 600,
        anchor: "middle",
        role: "element",
      },
    ];
    let right = elementHalf;
    const count = this.atom.hydrogens ?? 0;
    if (count > 0) {
      const hWidth = textWidth("H", fontPx);
      const subSize = fontPx * 0.68;
      const subWidth = count > 1 ? textWidth(String(count), subSize) : 0;
      if (this.hydrogensLeft) {
        const hCenter = -elementHalf - subWidth - hWidth / 2;
        out.push({
          text: "H",
          dx: hCenter,
          dy: 0,
          size: fontPx,
          weight: 600,
          anchor: "middle",
          role: "hydrogen",
        });
        if (count > 1) {
          out.push({
            text: String(count),
            dx: hCenter + hWidth / 2,
            dy: fontPx * 0.3,
            size: subSize,
            weight: 600,
            anchor: "start",
            role: "hydrogen",
          });
        }
      } else {
        const hCenter = elementHalf + hWidth / 2;
        out.push({
          text: "H",
          dx: hCenter,
          dy: 0,
          size: fontPx,
          weight: 600,
          anchor: "middle",
          role: "hydrogen",
        });
        right = elementHalf + hWidth;
        if (count > 1) {
          out.push({
            text: String(count),
            dx: right,
            dy: fontPx * 0.3,
            size: subSize,
            weight: 600,
            anchor: "start",
            role: "hydrogen",
          });
          right += subWidth;
        }
      }
    }
    const charge = chargeLabel(this.atom.charge);
    if (charge) {
      out.push({
        text: charge,
        dx: right + fontPx * 0.04,
        dy: -fontPx * 0.42,
        size: fontPx * 0.72,
        weight: 500,
        anchor: "start",
        role: "charge",
      });
    }
    return out;
  }

  /** Horizontal extent of the element + hydrogen runs, for the knockout behind them. */
  extent(fontPx: number): { left: number; right: number } {
    let left = Infinity;
    let right = -Infinity;
    for (const run of this.runs(fontPx)) {
      if (run.role === "charge") continue;
      const width = textWidth(run.text, run.size);
      const start = run.anchor === "middle" ? run.dx - width / 2 : run.dx;
      left = Math.min(left, start);
      right = Math.max(right, start + width);
    }
    return { left, right };
  }
}

/** Formal charge as a superscript: `+`, `2+`, `−`, `3−`; empty for 0/none. */
export function chargeLabel(charge: number | undefined): string {
  if (!charge) return "";
  if (charge > 0) return charge === 1 ? "+" : `${charge}+`;
  return charge === -1 ? "−" : `${Math.abs(charge)}−`;
}
