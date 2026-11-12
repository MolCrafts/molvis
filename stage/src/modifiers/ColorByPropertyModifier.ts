import { type Block, Frame } from "@molcrafts/molvis-core/molrs";
import { buildCategoricalColorLookup, getColorMap } from "../artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";
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
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    return !!atoms && atoms.has("source_id");
  }

  inspect(frame: Frame): void {
    if (!frame.has("atoms")) {
      this.availableColumns = [];
      this.detectedRange = null;
      return;
    }
    const atoms = frame.get("atoms");
    this.availableColumns = discoverColorableColumns(atoms);

    if (!this._config.columnName || !atoms.has(this._config.columnName)) {
      this.detectedRange = null;
      return;
    }

    const dtype = atoms.dtype(this._config.columnName);
    if (dtype === DType.Float) {
      const data = atoms.view(this._config.columnName) as Float64Array;
      if (data) {
        this.detectedRange = detectRange(data, atoms.nRows);
        return;
      }
    }
    if (dtype === DType.Uint) {
      const u64 = atoms.view(this._config.columnName) as BigUint64Array;
      const f32 = new Float64Array(u64.length);
      for (let i = 0; i < u64.length; i++) f32[i] = Number(u64[i]);
      this.detectedRange = detectRange(f32, atoms.nRows);
      return;
    }
    if (dtype === DType.Int) {
      const i32 = atoms.view(this._config.columnName) as Int32Array;
      const f32 = new Float64Array(i32.length);
      for (let i = 0; i < i32.length; i++) f32[i] = i32[i];
      this.detectedRange = detectRange(f32, atoms.nRows);
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

    if (!atoms.has(this._config.columnName)) return input;
    const dtype = atoms.dtype(this._config.columnName);

    const colorR = new Float64Array(atomCount);
    const colorG = new Float64Array(atomCount);
    const colorB = new Float64Array(atomCount);

    const isNumericDtype =
      dtype === DType.Float ||
      dtype === DType.Uint ||
      dtype === DType.U32 ||
      dtype === DType.Int;
    // String columns are always categorical; numeric columns are categorical
    // only when opted in (e.g. coloring by the integer source_id ordinal).
    const useCategorical =
      dtype === DType.String || (this._config.categorical && isNumericDtype);

    if (useCategorical) {
      const keys = readCategoricalKeys(atoms, this._config.columnName, dtype);
      if (!keys) return input;

      // Optional: a context built without an app (tests, headless frame
      // conversion) falls back to the stock canvas rather than throwing.
      const lookup = buildCategoricalColorLookup(keys, {
        strategy: context.app?.styleManager?.getCategoricalStrategy(),
      });
      for (let i = 0; i < atomCount; i++) {
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

      // Numeric: read as f32 and use sample()
      let numData: Float64Array | null = null;
      if (dtype === DType.Float) {
        numData = atoms.view(this._config.columnName) as Float64Array;
      } else if (dtype === DType.Uint) {
        const u64 = atoms.view(this._config.columnName) as BigUint64Array;
        numData = new Float64Array(u64.length);
        for (let j = 0; j < u64.length; j++) numData[j] = Number(u64[j]);
      } else if (dtype === DType.Int) {
        const i32 = atoms.view(this._config.columnName) as Int32Array;
        numData = new Float64Array(i32.length);
        for (let j = 0; j < i32.length; j++) numData[j] = i32[j];
      }
      if (!numData) return input;

      const { min, max } = detectRange(numData, atomCount);
      const userRange = this._config.range;
      const rMin = userRange ? userRange.min : min;
      const rMax = userRange ? userRange.max : max;
      const span = rMax - rMin;
      const invSpan = span > 1e-12 ? 1 / span : 0;

      for (let i = 0; i < atomCount; i++) {
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
    if (!result.has("atoms")) return input;
    const resultAtoms = result.get("atoms");

    resultAtoms.set(COLOR_OVERRIDE_R, colorR);
    resultAtoms.set(COLOR_OVERRIDE_G, colorG);
    resultAtoms.set(COLOR_OVERRIDE_B, colorB);

    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    if (bonds) {
      result.set("bonds", bonds);
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
    const data = block.copy(columnName) as string[];
    return data ? data.map((value) => value ?? "UNK") : null;
  }
  if (dtype === DType.Float) {
    const data = block.view(columnName) as Float64Array;
    return data ? Array.from(data, (v) => String(v)) : null;
  }
  if (dtype === DType.Uint) {
    const data = block.view(columnName) as BigUint64Array;
    return data ? Array.from(data, (v) => String(v)) : null;
  }
  if (dtype === DType.Int) {
    const data = block.view(columnName) as Int32Array;
    return data ? Array.from(data, (v) => String(v)) : null;
  }
  return null;
}

function detectRange(
  data: Float64Array,
  count: number,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
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
