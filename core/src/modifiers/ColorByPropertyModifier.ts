import { type Block, Frame } from "@molcrafts/molrs";
import {
  DEFAULT_CATEGORICAL_COLOR_MAP,
  buildCategoricalColorLookup,
  getColorMap,
} from "../artist/palette";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";

// Columns injected into the atoms Block to override default element coloring.
// buildAtomBuffers detects these and uses them for per-atom colors.
export const COLOR_OVERRIDE_R = "__color_r";
export const COLOR_OVERRIDE_G = "__color_g";
export const COLOR_OVERRIDE_B = "__color_b";

export interface ColorByPropertyConfig {
  /** Column name in atoms Block. Empty string = disabled. */
  columnName: string;
  /** Deprecated user-facing choice; numeric columns now use a fixed viridis ramp. */
  colormap: string;
  /** Manual range override. null = auto-detect. */
  range: { min: number; max: number } | null;
  /** Clamp out-of-range values (true) or fade to gray (false). */
  clampOutOfRange: boolean;
}

/**
 * ColorByPropertyModifier — colors atoms by any per-atom column.
 *
 * Numeric columns → fixed viridis ramp via `ColorMap.sample(t)`
 * String columns → categorical coloring via dataset-level Glasbey assignment
 *
 * Injects __color_r/g/b Float64Array columns into the output Frame.
 */
export class ColorByPropertyModifier extends BaseModifier {
  private _config: ColorByPropertyConfig = {
    columnName: "",
    colormap: "viridis",
    range: null,
    clampOutOfRange: true,
  };
  private _warnedStringColormapIgnored = false;
  private _warnedNumericColormapFallback = false;

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

  get colormap(): string {
    return this._config.colormap;
  }
  set colormap(v: string) {
    this._config.colormap = v;
    this._warnedStringColormapIgnored = false;
    this._warnedNumericColormapFallback = false;
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

  getCacheKey(): string {
    const r = this._config.range;
    const rangeStr = r ? `${r.min}:${r.max}` : "auto";
    return `${super.getCacheKey()}:${this._config.columnName}:${rangeStr}:${this._config.clampOutOfRange}`;
  }

  inspect(frame: Frame): void {
    const atoms = frame.getBlock("atoms");
    if (!atoms) {
      this.availableColumns = [];
      this.detectedRange = null;
      return;
    }
    this.availableColumns = discoverColorableColumns(atoms);

    if (!this._config.columnName) {
      this.detectedRange = null;
      return;
    }

    const dtype = atoms.dtype(this._config.columnName);
    if (dtype === DType.F64) {
      const data = atoms.viewColF(this._config.columnName);
      if (data) {
        this.detectedRange = detectRange(data, atoms.nrows());
        return;
      }
    }
    if (dtype === DType.U32) {
      const u32 = atoms.viewColU32(this._config.columnName);
      const f32 = new Float64Array(u32.length);
      for (let i = 0; i < u32.length; i++) f32[i] = u32[i];
      this.detectedRange = detectRange(f32, atoms.nrows());
      return;
    }
    if (dtype === DType.I32) {
      const i32 = atoms.viewColI32(this._config.columnName);
      const f32 = new Float64Array(i32.length);
      for (let i = 0; i < i32.length; i++) f32[i] = i32[i];
      this.detectedRange = detectRange(f32, atoms.nrows());
      return;
    }
    this.detectedRange = null;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    if (!this._config.columnName) return input;

    const atomCount = atoms.nrows();
    if (atomCount === 0) return input;

    const dtype = atoms.dtype(this._config.columnName);
    if (!dtype) return input;

    const colorR = new Float64Array(atomCount);
    const colorG = new Float64Array(atomCount);
    const colorB = new Float64Array(atomCount);

    if (dtype === DType.String) {
      const data = atoms.copyColStr(this._config.columnName) as
        | string[]
        | undefined;
      if (!data) return input;
      const normalized = data.map((value) => value ?? "UNK");

      if (
        this._config.colormap !== DEFAULT_CATEGORICAL_COLOR_MAP &&
        !this._warnedStringColormapIgnored
      ) {
        logger.warn(
          `[ColorByPropertyModifier] String column '${this._config.columnName}' ignores continuous colormap '${this._config.colormap}' and uses '${DEFAULT_CATEGORICAL_COLOR_MAP}'.`,
        );
        this._warnedStringColormapIgnored = true;
      }

      const lookup = buildCategoricalColorLookup(normalized);
      for (let i = 0; i < atomCount; i++) {
        const [r, g, b] = lookup.get(normalized[i])!;
        colorR[i] = r;
        colorG[i] = g;
        colorB[i] = b;
      }
    } else {
      if (
        this._config.colormap &&
        this._config.colormap !== "viridis" &&
        !this._warnedNumericColormapFallback
      ) {
        logger.warn(
          `[ColorByPropertyModifier] Numeric column '${this._config.columnName}' uses the fixed 'viridis' ramp; ignoring '${this._config.colormap}'.`,
        );
        this._warnedNumericColormapFallback = true;
      }

      const cm = getColorMap("viridis");
      if (cm.kind !== "continuous") {
        if (!this._warnedNumericColormapFallback) {
          logger.warn(
            `[ColorByPropertyModifier] Internal numeric colormap 'viridis' is unavailable; numeric coloring cannot proceed.`,
          );
          this._warnedNumericColormapFallback = true;
        }
        return input;
      }

      // Numeric: read as f32 and use sample()
      let numData: Float64Array | null = null;
      if (dtype === DType.F64) {
        numData = atoms.viewColF(this._config.columnName);
      } else if (dtype === DType.U32) {
        const u32 = atoms.viewColU32(this._config.columnName);
        numData = new Float64Array(u32.length);
        for (let j = 0; j < u32.length; j++) numData[j] = u32[j];
      } else if (dtype === DType.I32) {
        const i32 = atoms.viewColI32(this._config.columnName);
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
    result.insertBlock("atoms", atoms);
    const resultAtoms = result.getBlock("atoms");
    if (!resultAtoms) return input;

    resultAtoms.setColF(COLOR_OVERRIDE_R, colorR);
    resultAtoms.setColF(COLOR_OVERRIDE_G, colorG);
    resultAtoms.setColF(COLOR_OVERRIDE_B, colorB);

    const bonds = input.getBlock("bonds");
    if (bonds) {
      result.insertBlock("bonds", bonds);
    }

    const box = input.simbox;
    if (box) {
      result.simbox = box;
    }

    return result;
  }
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
