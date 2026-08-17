/**
 * Solid–liquid classification (Steinhardt-based) → per-atom columns + color.
 *
 * Writes:
 * - `solid_liquid` — 1 solid / 0 liquid
 * - `solid_liquid_n_bonds` — number of solid-like neighbor bonds
 *
 * When `colorScene` is true, colors atoms categorically by `solid_liquid`.
 */

import { type Frame, WasmSolidLiquid } from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { hexToLinearRgb } from "../artist/palette";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";
import {
  applyColumnColors,
  cloneFrameWithAtoms,
  SOLID_LIQUID_COLUMN,
  SOLID_LIQUID_N_BONDS_COLUMN,
  writeAtomF64Column,
} from "./structure_order_shared";

interface SolidLiquidOut {
  l: number;
  nSolidBonds: number[];
  isSolid: boolean[];
}

function isSolidLiquidOut(v: unknown): v is SolidLiquidOut {
  if (!v || typeof v !== "object") return false;
  const o = v as SolidLiquidOut;
  return Array.isArray(o.nSolidBonds) && Array.isArray(o.isSolid);
}

export class SolidLiquidModifier extends BaseModifier {
  static readonly NAME = "Solid-liquid";

  private _l = 6;
  private _cutoff = 3.0;
  private _qThreshold: number | null = null;
  private _nThreshold: number | null = null;
  private _normalizeQ = true;
  private _colorScene = true;
  private _liquidColor = "#4E79A7";
  private _solidColor = "#E15759";

  constructor(id = "solid-liquid") {
    super(
      id,
      SolidLiquidModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get l(): number {
    return this._l;
  }
  get cutoff(): number {
    return this._cutoff;
  }
  get qThreshold(): number | null {
    return this._qThreshold;
  }
  get nThreshold(): number | null {
    return this._nThreshold;
  }
  get normalizeQ(): boolean {
    return this._normalizeQ;
  }
  get colorScene(): boolean {
    return this._colorScene;
  }
  get liquidColor(): string {
    return this._liquidColor;
  }
  get solidColor(): string {
    return this._solidColor;
  }

  get primaryColumn(): string {
    return SOLID_LIQUID_COLUMN;
  }

  setL(l: number): void {
    this._l = Math.max(0, Math.min(20, Math.floor(l)));
  }

  setCutoff(cutoff: number): void {
    this._cutoff = Math.max(0.1, cutoff);
  }

  setQThreshold(v: number | null): void {
    this._qThreshold = v !== null && Number.isFinite(v) ? v : null;
  }

  setNThreshold(v: number | null): void {
    this._nThreshold =
      v !== null && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;
  }

  setNormalizeQ(on: boolean): void {
    this._normalizeQ = on;
  }

  setColorScene(on: boolean): void {
    this._colorScene = on;
  }

  /**
   * @description Liquid-class colour as `#RRGGBB` (display sRGB).
   * Written as linear RGB `__color_*` when `colorScene` is on.
   * @param v - Uppercase or lowercase `#RRGGBB`.
   */
  setLiquidColor(v: string): void {
    this._liquidColor = v;
  }

  /**
   * @description Solid-class colour as `#RRGGBB` (display sRGB).
   * Written as linear RGB `__color_*` when `colorScene` is on.
   * @param v - Uppercase or lowercase `#RRGGBB`.
   */
  setSolidColor(v: string): void {
    this._solidColor = v;
  }

  /**
   * Auto-attach predicate — always false. Classification is user-added
   * only; a truthy `matches` would fire on every atom frame and, with
   * default `colorScene`, overwrite element colors with the solid/liquid
   * categorical map.
   */
  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    return atoms !== undefined && atoms.nrows() > 0;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:l=${this._l}:c=${this._cutoff}:q=${this._qThreshold ?? "def"}:n=${this._nThreshold ?? "def"}:nq=${this._normalizeQ}:color=${this._colorScene}:${this._liquidColor}:${this._solidColor}`;
  }

  apply(input: Frame, _ctx: PipelineContext): Frame {
    if (!this.isApplicable(input)) return input;
    const n = input.getBlock("atoms")?.nrows() ?? 0;
    if (n === 0) return input;

    let calc: WasmSolidLiquid | null = null;
    // SolidLiquid → compute_qlm needs bond vectors (same as Steinhardt).
    const query = new SpatialNeighborQuery(this._cutoff, {
      disp: true,
      atomCount: n,
    });
    let neighbors: ReturnType<SpatialNeighborQuery["build"]> | null = null;

    try {
      neighbors = query.build(input);

      calc = new WasmSolidLiquid(
        this._l,
        this._qThreshold,
        this._nThreshold,
        this._normalizeQ,
      );
      const raw = calc.compute(input, neighbors);
      if (!isSolidLiquidOut(raw)) {
        logger.warn("[Solid-liquid] unexpected compute payload");
        return input;
      }
      if (raw.isSolid.length < n || raw.nSolidBonds.length < n) {
        logger.warn(
          `[Solid-liquid] result length ${raw.isSolid.length} < n=${n}`,
        );
        return input;
      }

      const result = cloneFrameWithAtoms(input);
      if (!result) return input;
      const atoms = result.getBlock("atoms");
      if (!atoms) return input;

      const solid = new Float64Array(n);
      const bonds = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        solid[i] = raw.isSolid[i] ? 1 : 0;
        bonds[i] = raw.nSolidBonds[i];
      }
      writeAtomF64Column(atoms, SOLID_LIQUID_COLUMN, solid);
      writeAtomF64Column(atoms, SOLID_LIQUID_N_BONDS_COLUMN, bonds);

      if (this._colorScene) {
        applyColumnColors(atoms, SOLID_LIQUID_COLUMN, {
          categorical: true,
          categoryColors: {
            "0": hexToLinearRgb(this._liquidColor),
            "1": hexToLinearRgb(this._solidColor),
          },
        });
      }

      return result;
    } catch (err) {
      logger.warn("[Solid-liquid] compute failed", err as Error);
      return input;
    } finally {
      calc?.free();
      neighbors?.free();
      query.free();
    }
  }
}
