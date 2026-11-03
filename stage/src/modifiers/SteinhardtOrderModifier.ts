/**
 * Steinhardt order parameters → per-atom columns → optional scene color.
 *
 * Writes `steinhardt_q{l}` (and `steinhardt_w{l}` when enabled) then, when
 * `colorScene` is true, injects `__color_*` from the primary Qℓ column so
 * Draw Atoms picks up the map without a separate Color by Property step.
 * Downstream Color by Property can still target those columns when
 * `colorScene` is off.
 */

import {
  type Frame,
  Steinhardt,
  type SteinhardtResult,
} from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";
import {
  applyColumnColors,
  cloneFrameWithAtoms,
  steinhardtQColumn,
  steinhardtWColumn,
  writeAtomF64Column,
} from "./structure_order_shared";

/**
 * `SteinhardtResult.toJSON()`: `features` is `n_particles × (n_l [+ n_l])` —
 * `q_ℓ` per requested ℓ, then `w_ℓ` when `wl` is on.
 */
interface SteinhardtOut {
  l: number[];
  features: { dim: number[]; data: number[] };
}

function isSteinhardtOut(v: unknown): v is SteinhardtOut {
  if (!v || typeof v !== "object") return false;
  const o = v as SteinhardtOut;
  return (
    Array.isArray(o.l) &&
    !!o.features &&
    Array.isArray(o.features.dim) &&
    o.features.dim.length === 2 &&
    Array.isArray(o.features.data)
  );
}

/** Column `k` of the row-major `features` matrix. */
function featureColumn(out: SteinhardtOut, k: number): Float64Array {
  const [rows, cols] = out.features.dim;
  const column = new Float64Array(rows);
  for (let i = 0; i < rows; i++) column[i] = out.features.data[i * cols + k];
  return column;
}

export class SteinhardtOrderModifier extends BaseModifier {
  static readonly NAME = "Steinhardt order";

  private _lValues: number[] = [6];
  private _cutoff = 3.0;
  private _average = false;
  private _wl = false;
  private _wlNormalize = false;
  /** When true, map primary Qℓ onto atom colors. */
  private _colorScene = true;
  /** ℓ used for coloring (must be in lValues). */
  private _colorL = 6;

  constructor(id = "steinhardt-order") {
    super(
      id,
      SteinhardtOrderModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get lValues(): readonly number[] {
    return this._lValues;
  }
  get cutoff(): number {
    return this._cutoff;
  }
  get average(): boolean {
    return this._average;
  }
  get wl(): boolean {
    return this._wl;
  }
  get wlNormalize(): boolean {
    return this._wlNormalize;
  }
  get colorScene(): boolean {
    return this._colorScene;
  }
  get colorL(): number {
    return this._colorL;
  }

  /** Primary column written / colored (e.g. `steinhardt_q6`). */
  get primaryColumn(): string {
    return steinhardtQColumn(this._colorL);
  }

  setLValues(values: readonly number[]): void {
    const next = [
      ...new Set(
        values.map((v) => Math.floor(v)).filter((v) => v >= 0 && v <= 20),
      ),
    ].sort((a, b) => a - b);
    if (next.length === 0) return;
    this._lValues = next;
    if (!this._lValues.includes(this._colorL)) {
      this._colorL = this._lValues[0];
    }
  }

  setCutoff(cutoff: number): void {
    this._cutoff = Math.max(0.1, cutoff);
  }

  setAverage(on: boolean): void {
    this._average = on;
  }

  setWl(on: boolean): void {
    this._wl = on;
  }

  setWlNormalize(on: boolean): void {
    this._wlNormalize = on;
  }

  setColorScene(on: boolean): void {
    this._colorScene = on;
  }

  setColorL(l: number): void {
    const li = Math.floor(l);
    if (this._lValues.includes(li)) this._colorL = li;
  }

  /**
   * Auto-attach predicate — always false. Order analysis is user-added
   * only; a truthy `matches` would fire on every atom frame and, with
   * default `colorScene`, stamp viridis `__color_*` over CPK element
   * colors (the "all atoms one color" bug on protein load).
   */
  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    return atoms !== undefined && atoms.nRows > 0;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:l=${this._lValues.join(",")}:c=${this._cutoff}:avg=${this._average}:wl=${this._wl}/${this._wlNormalize}:color=${this._colorScene}:${this._colorL}`;
  }

  apply(input: Frame, _ctx: PipelineContext): Frame {
    if (!this.isApplicable(input)) return input;
    const n = input.has("atoms") ? input.get("atoms").nRows : 0;
    if (n === 0) return input;

    let steinhardt: Steinhardt | null = null;
    let handle: SteinhardtResult | null = null;
    // Steinhardt needs bond displacement vectors (θ, φ from r̂_ij).
    // SpatialNeighborQuery defaults disp=false for lean RDF/cluster tables.
    const query = new SpatialNeighborQuery(this._cutoff, {
      disp: true,
      atomCount: n,
    });
    let neighbors: ReturnType<SpatialNeighborQuery["build"]> | null = null;

    try {
      neighbors = query.build(input);

      steinhardt = new Steinhardt(
        new Uint32Array(this._lValues),
        this._average,
        this._wl,
        this._wlNormalize,
      );
      handle = steinhardt.compute({ neighbors });
      const raw: unknown = handle.toJSON();
      if (!isSteinhardtOut(raw)) {
        logger.warn("[Steinhardt order] unexpected compute payload");
        return input;
      }

      const result = cloneFrameWithAtoms(input);
      if (!result) return input;
      if (!result.has("atoms")) return input;
      const atoms = result.get("atoms");

      const [rows, cols] = raw.features.dim;
      if (rows < n) {
        logger.warn(`[Steinhardt order] result rows ${rows} < n=${n}`);
        return input;
      }
      const hasWl = cols >= 2 * raw.l.length;
      for (let li = 0; li < raw.l.length; li++) {
        const l = raw.l[li];
        writeAtomF64Column(atoms, steinhardtQColumn(l), featureColumn(raw, li));
        if (this._wl && hasWl) {
          writeAtomF64Column(
            atoms,
            steinhardtWColumn(l),
            featureColumn(raw, raw.l.length + li),
          );
        }
      }

      if (this._colorScene) {
        const col = steinhardtQColumn(this._colorL);
        if (atoms.has(col)) {
          applyColumnColors(atoms, col, { categorical: false });
        }
      }

      return result;
    } catch (err) {
      logger.warn("[Steinhardt order] compute failed", err as Error);
      return input;
    } finally {
      handle?.free();
      steinhardt?.free();
      neighbors?.free();
      query.free();
    }
  }
}
