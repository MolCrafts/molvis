import { Frame } from "@molcrafts/molvis-core/molrs";
import { hexToLinearRgb } from "../artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { ProjectParams } from "../project/params";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Modifier that gives individual atoms explicit colors, by row index.
 *
 * Where {@link AssignColorModifier} colors whatever a preceding selection
 * picked, this one holds its own `row → color` table, so a controller can
 * recolor atoms in one call without building a selection first
 * (`view.color_atoms`). Atoms it does not name keep the color the rest of the
 * pipeline gave them; an override already present (from an earlier color
 * modifier) is kept unless this table names the row.
 */
export class AtomColorModifier extends BaseModifier {
  static readonly NAME = "Atom Colors";

  private colors = new Map<number, string>();

  constructor(id = "atom-colors") {
    super(
      id,
      AtomColorModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  /** Number of atoms this modifier currently colors. */
  get size(): number {
    return this.colors.size;
  }

  /**
   * Give `indices` the color `color` (`#RRGGBB`), or return them to the
   * pipeline's color when `color` is `null`. With `reset`, every earlier
   * assignment is forgotten first.
   *
   * @throws when an index is not a non-negative integer or `color` is not
   * `#RRGGBB`; nothing changes then.
   */
  assign(
    indices: readonly number[],
    color: string | null,
    options?: { reset?: boolean },
  ): void {
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`atom index must be a non-negative integer: ${index}`);
      }
    }
    if (color !== null && !HEX_COLOR.test(color)) {
      throw new Error(`color must be #RRGGBB: ${JSON.stringify(color)}`);
    }
    const next = options?.reset
      ? new Map<number, string>()
      : new Map(this.colors);
    for (const index of indices) {
      if (color === null) next.delete(index);
      else next.set(index, color.toUpperCase());
    }
    this.colors = next;
  }

  /** Forget every assignment. */
  clear(): void {
    this.colors = new Map();
  }

  toProjectParams(): ProjectParams {
    return { colors: [...this.colors] };
  }

  fromProjectParams(params: ProjectParams): void {
    if (!Array.isArray(params.colors)) {
      throw new Error(
        "Atom Colors: colors must be an array of [index, color] pairs",
      );
    }
    this.clear();
    for (const entry of params.colors) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[1] !== "string"
      ) {
        throw new Error(
          "Atom Colors: each color must be an [index, color] pair",
        );
      }
      this.assign([entry[0]], entry[1]);
    }
  }

  getCacheKey(): string {
    const entries = [...this.colors].sort((a, b) => a[0] - b[0]);
    return `${super.getCacheKey()}:${JSON.stringify(entries)}`;
  }

  apply(input: Frame): Frame {
    if (this.colors.size === 0 || !input.has("atoms")) return input;
    const atoms = input.get("atoms");
    const atomCount = atoms.nRows;
    if (atomCount === 0) return input;

    const channel = (key: string): Float64Array =>
      atoms.has(key)
        ? new Float64Array(atoms.view(key) as Float64Array)
        : new Float64Array(atomCount).fill(Number.NaN);
    const red = channel(COLOR_OVERRIDE_R);
    const green = channel(COLOR_OVERRIDE_G);
    const blue = channel(COLOR_OVERRIDE_B);
    for (const [index, hex] of this.colors) {
      if (index >= atomCount) continue;
      const [r, g, b] = hexToLinearRgb(hex);
      red[index] = r;
      green[index] = g;
      blue[index] = b;
    }

    const result = new Frame();
    for (const name of input.keys()) result.set(name, input.get(name));
    for (const name of input.metaKeys()) {
      const value = input.getMeta(name);
      if (value !== undefined) result.setMeta(name, value);
    }
    const resultAtoms = result.get("atoms");
    resultAtoms.set(COLOR_OVERRIDE_R, red);
    resultAtoms.set(COLOR_OVERRIDE_G, green);
    resultAtoms.set(COLOR_OVERRIDE_B, blue);
    const box = input.box;
    if (box) result.box = box;
    return result;
  }
}
