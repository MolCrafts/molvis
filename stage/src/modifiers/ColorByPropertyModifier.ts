import { type Block, Frame } from "@molcrafts/molvis-core/molrs";
import { buildCategoricalColorLookup, getColorMap } from "../artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import {
  asFloat64,
  DType,
  isNumericDtype,
  type NumericArray,
} from "../utils/dtype";
import { logger } from "../utils/logger";

export interface ColorByPropertyConfig {
  /** Column name in atoms Block. Empty string = disabled. */
  columnName: string;
  /** Manual range override. null = auto-detect. */
  range: { min: number; max: number } | null;
  /** Clamp out-of-range values (true) or fade to gray (false). */
  clampOutOfRange: boolean;
  /**
   * Treat a NUMERIC column as categorical (distinct color per distinct value
   * via the categorical palette) instead of the continuous viridis ramp. Used
   * to color by `source_id`. String columns are always categorical regardless.
   */
  categorical: boolean;
}

/**
 * ColorByPropertyModifier — colors atoms by any per-atom column.
 *
 * Numeric columns → fixed viridis ramp via `ColorMap.sample(t)`
 * String columns → categorical coloring via the selected tab10/ovito strategy
 *
 * A row the column marks null (molrs `Block.validity`) has no property value:
 * it takes no part in the range or the categories, and gets no override (NaN),
 * so the atom keeps its own style color rather than the color of the filled 0.
 *
 * Injects __color_r/g/b Float64Array columns into the output Frame.
 */
export class ColorByPropertyModifier extends BaseModifier {
  private _config: ColorByPropertyConfig = {
    columnName: "",
    range: null,
    clampOutOfRange: true,
    categorical: false,
  };

  /** Detected min/max — populated by inspect(), exposed for UI display. */
  public detectedRange: { min: number; max: number } | null = null;

  /** Available colorable columns — populated by inspect(), exposed for UI dropdown. */
  public availableColumns: { name: string; dtype: string }[] = [];

  constructor(id = "color-by-property-default") {
    super(
      id,
      "Color by Property",
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get columnName(): string {
    return this._config.columnName;
  }
  set columnName(v: string) {
    this._config.columnName = v;
  }

  get range(): { min: number; max: number } | null {
    return this._config.range;
  }
  set range(v: { min: number; max: number } | null) {
    this._config.range = v;
  }

  get clampOutOfRange(): boolean {
    return this._config.clampOutOfRange;
  }
  set clampOutOfRange(v: boolean) {
    this._config.clampOutOfRange = v;
  }

  get categorical(): boolean {
    return this._config.categorical;
  }
  set categorical(v: boolean) {
    this._config.categorical = v;
  }

  getCacheKey(): string {
    const r = this._config.range;
    const rangeStr = r ? `${r.min}:${r.max}` : "auto";
    return `${super.getCacheKey()}:${this._config.columnName}:${rangeStr}:${this._config.clampOutOfRange}:cat=${this._config.categorical}`;
  }

  /**
   * Only gates the `source_id` column: not applicable when coloring by
   * `source_id` but the frame has no such column (single-source / no combine).
   * Every other column is universally applicable (default).
   */
  isApplicable(frame: Frame): boolean {
    if (this._config.columnName !== "source_id") return true;
    return frame.has("atoms") && frame.get("atoms").has("source_id");
  }

  inspect(frame: Frame): void {
    if (!frame.has("atoms")) {
      this.availableColumns = [];
      this.detectedRange = null;
      return;
    }
    const atoms = frame.get("atoms");
    this.availableColumns = discoverColorableColumns(atoms);

    if (!this._config.columnName) {
      this.detectedRange = null;
      return;
    }

    const dtype = atoms.has(this._config.columnName)
      ? atoms.dtype(this._config.columnName)
      : undefined;
    const valid = dtype ? atoms.validity(this._config.columnName) : undefined;
    if (isNumericDtype(dtype)) {
      const data = asFloat64(
        atoms.view(this._config.columnName) as NumericArray,
      );
      this.detectedRange = detectRange(data, atoms.nRows, valid);
      return;
    }
    this.detectedRange = null;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");
    if (!this._config.columnName) return input;

    const atomCount = atoms.nRows;
    if (atomCount === 0) return input;

    const dtype = atoms.has(this._config.columnName)
      ? atoms.dtype(this._config.columnName)
      : undefined;
    if (!dtype) return input;
    // 0 = null row: no value to color by. Undefined = every row has one.
    const valid = atoms.validity(this._config.columnName);

    // NaN = no override; a null row keeps its style color.
    const colorR = new Float64Array(atomCount).fill(Number.NaN);
    const colorG = new Float64Array(atomCount).fill(Number.NaN);
    const colorB = new Float64Array(atomCount).fill(Number.NaN);

    const categoricalNumeric = isNumericDtype(dtype);
    // String columns are always categorical; numeric columns are categorical
    // only when opted in (e.g. coloring by the integer source_id ordinal).
    const useCategorical =
      dtype === DType.String ||
      (this._config.categorical && categoricalNumeric);

    if (useCategorical) {
      const keys = readCategoricalKeys(atoms, this._config.columnName, dtype);
      if (!keys) return input;

      // Optional: a context built without an app (tests, headless frame
      // conversion) falls back to the stock canvas rather than throwing.
      // A null row's filled value is not a category.
      const lookup = buildCategoricalColorLookup(
        valid ? keys.filter((_, i) => valid[i] !== 0) : keys,
        { strategy: context.app?.styleManager?.getCategoricalStrategy() },
      );
      for (let i = 0; i < atomCount; i++) {
        if (valid && valid[i] === 0) continue;
        const rgb = lookup.get(keys[i]);
        if (!rgb) continue;
        const [r, g, b] = rgb;
        colorR[i] = r;
        colorG[i] = g;
        colorB[i] = b;
      }
    } else {
      const cm = getColorMap("viridis");
      if (cm.kind !== "continuous") {
        logger.warn(
          `[ColorByPropertyModifier] Internal numeric colormap 'viridis' is unavailable; numeric coloring cannot proceed.`,
        );
        return input;
      }

      // Numeric: read as f64 and use sample()
      if (!isNumericDtype(dtype)) return input;
      const numData = asFloat64(
        atoms.view(this._config.columnName) as NumericArray,
      );

      const { min, max } = detectRange(numData, atomCount, valid);
      const userRange = this._config.range;
      const rMin = userRange ? userRange.min : min;
      const rMax = userRange ? userRange.max : max;
      const span = rMax - rMin;
      const invSpan = span > 1e-12 ? 1 / span : 0;

      for (let i = 0; i < atomCount; i++) {
        if (valid && valid[i] === 0) continue;
        let t = (numData[i] - rMin) * invSpan;
        if (this._config.clampOutOfRange) {
          t = Math.max(0, Math.min(1, t));
        }
        const [r, g, b] = cm.sample(t);
        colorR[i] = r;
        colorG[i] = g;
        colorB[i] = b;
      }
    }

    // Create new Frame with color override columns
    const result = new Frame();
    result.set("atoms", atoms);
    const resultAtoms = result.has("atoms") ? result.get("atoms") : undefined;
    if (!resultAtoms) return input;

    resultAtoms.set(COLOR_OVERRIDE_R, colorR);
    resultAtoms.set(COLOR_OVERRIDE_G, colorG);
    resultAtoms.set(COLOR_OVERRIDE_B, colorB);

    if (input.has("bonds")) {
      result.set("bonds", input.get("bonds"));
    }

    const box = input.box;
    if (box) {
      result.box = box;
    }

    return result;
  }
}

/**
 * Read a column as categorical string keys. String columns map nullish → "UNK";
 * numeric columns (F64/U64/I32) are stringified so distinct values become
 * distinct categories. Returns null when the column is absent/unsupported.
 */
function readCategoricalKeys(
  block: Block,
  columnName: string,
  dtype: string,
): string[] | null {
  if (dtype === DType.String) {
    const data = block.copy(columnName) as string[] | undefined;
    return data ? data.map((value) => value ?? "UNK") : null;
  }
  if (isNumericDtype(dtype)) {
    const data = block.view(columnName) as NumericArray;
    const values = data as unknown as ArrayLike<number | bigint>;
    return Array.from(values, (v) => String(v));
  }
  return null;
}

/** Range over the rows that hold a value (`valid[i] !== 0`, or all rows). */
function detectRange(
  data: Float64Array,
  count: number,
  valid: Uint8Array | undefined,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    if (valid && valid[i] === 0) continue;
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

const SKIP_COLUMNS = new Set(["atomi", "atomj"]);

function discoverColorableColumns(
  block: Block,
): { name: string; dtype: string }[] {
  const result: { name: string; dtype: string }[] = [];
  for (const key of block.keys()) {
    if (SKIP_COLUMNS.has(key)) continue;
    if (key.startsWith("__")) continue;
    const dtype = block.dtype(key);
    if (dtype) {
      result.push({ name: key, dtype });
    }
  }
  return result;
}
