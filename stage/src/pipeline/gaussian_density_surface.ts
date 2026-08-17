/**
 * Gaussian density surface — scene-changing Visualization modifier.
 *
 * Runs molrs `WasmGaussianDensity` on a frame whose **density domain**
 * is the atom AABB (+ pad), not the crystallographic primary cell.
 * That keeps the isosurface co-located with Particles / Ribbon: freud-
 * style GaussianDensity always deposits on the simbox grid with PBC
 * wrap-around, which folds ASU atoms (outside the cell) into the
 * primary cell while atoms still draw at deposited Cartn — the
 * "surface wrapped, protein not" bug.
 *
 * Does not mutate the pipeline frame. Does not auto-attach
 * (`matches` is false): density is user-added Visualization.
 */

import {
  Box,
  type Frame,
  Frame as MolrsFrame,
  WasmGaussianDensity,
} from "@molcrafts/molvis-core/molrs";
import {
  DEFAULT_ISOSURFACE_STYLE,
  type IsosurfaceStyle,
} from "../artist/isosurface/isosurface_renderer";
import { viewAtomCoords } from "../io/atom_coords";
import { logger } from "../utils/logger";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

interface Grid3Out {
  data: number[] | Float64Array;
  shape: [number, number, number] | number[];
}

function isGrid3Out(v: unknown): v is Grid3Out {
  if (!v || typeof v !== "object") return false;
  const o = v as Grid3Out;
  return (
    (Array.isArray(o.data) || ArrayBuffer.isView(o.data)) &&
    Array.isArray(o.shape) &&
    o.shape.length === 3
  );
}

/**
 * Orthorhombic, **non-periodic** box covering atom AABB + `pad` Å on
 * each side. Used as the GaussianDensity / isosurface domain so the
 * surface sits with the drawn atoms, not folded into `frame.box`.
 */
export function densityDomainFromAtoms(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  n: number,
  pad: number,
): { origin: Float64Array; h: Float64Array } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    if (xi < minX) minX = xi;
    if (yi < minY) minY = yi;
    if (zi < minZ) minZ = zi;
    if (xi > maxX) maxX = xi;
    if (yi > maxY) maxY = yi;
    if (zi > maxZ) maxZ = zi;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }
  const p = Math.max(0, pad);
  // Minimum edge so a single atom still gets a usable grid.
  const minEdge = Math.max(2 * p, 1.0);
  const lx = Math.max(maxX - minX + 2 * p, minEdge);
  const ly = Math.max(maxY - minY + 2 * p, minEdge);
  const lz = Math.max(maxZ - minZ + 2 * p, minEdge);
  const origin = new Float64Array([minX - p, minY - p, minZ - p]);
  // Column-major 3×3 H (same layout as Box.hMatrix / wire).
  const h = new Float64Array([lx, 0, 0, 0, ly, 0, 0, 0, lz]);
  return { origin, h };
}

export class GaussianDensitySurfaceModifier extends BaseModifier {
  static readonly NAME = "Gaussian density surface";

  private _nx = 32;
  private _ny = 32;
  private _nz = 32;
  private _sigma = 1.0;
  private _rMax: number | null = null;
  private _style: IsosurfaceStyle = {
    ...DEFAULT_ISOSURFACE_STYLE,
    channel: "density",
    showNegative: false,
  };
  private _isovalueAuto = true;

  constructor(id = "gaussian-density-surface") {
    super(
      id,
      GaussianDensitySurfaceModifier.NAME,
      new Set([ModifierCapability.Draws]),
    );
  }

  get nx(): number {
    return this._nx;
  }
  get ny(): number {
    return this._ny;
  }
  get nz(): number {
    return this._nz;
  }
  get sigma(): number {
    return this._sigma;
  }
  get rMax(): number | null {
    return this._rMax;
  }
  get style(): IsosurfaceStyle {
    return this._style;
  }

  setGrid(nx: number, ny: number, nz: number): void {
    this._nx = Math.max(2, Math.floor(nx));
    this._ny = Math.max(2, Math.floor(ny));
    this._nz = Math.max(2, Math.floor(nz));
  }

  setSigma(sigma: number): void {
    this._sigma = Math.max(1e-6, sigma);
  }

  setRMax(rMax: number | null): void {
    this._rMax = rMax !== null && rMax > 0 ? rMax : null;
  }

  setStyle(patch: Partial<IsosurfaceStyle>): void {
    if (patch.isovalue !== undefined) {
      this._isovalueAuto = false;
      patch = {
        ...patch,
        isovalue: Math.max(0, patch.isovalue),
      };
    }
    this._style = { ...this._style, ...patch, channel: "density" };
  }

  /**
   * Auto-attach only for default visual layers under the file loader.
   * Density is opt-in Visualization — never auto-attach.
   */
  matches(_frame: Frame): boolean {
    return false;
  }

  /** Needs atoms; domain is derived from atom AABB (simulation cell optional). */
  isApplicable(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    return atoms !== undefined && atoms.nrows() > 0;
  }

  getCacheKey(): string {
    const s = this._style;
    return `${super.getCacheKey()}:g=${this._nx}x${this._ny}x${this._nz}:σ=${this._sigma}:r=${this._rMax ?? "auto"}:iv=${s.isovalue}:o=${s.opacity}:rgb=${s.color.join(",")}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    if (!this.isApplicable(input)) return input;

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) {
      logger.warn("[Gaussian density surface] missing x/y/z; skip draw");
      return input;
    }

    const n = atoms.nrows();
    const pad = Math.max(3 * this._sigma, this._rMax ?? 0, 1.0);
    const { origin, h } = densityDomainFromAtoms(
      coords.x,
      coords.y,
      coords.z,
      n,
      pad,
    );

    let gd: WasmGaussianDensity | null = null;
    let computeFrame: Frame | null = null;
    let drawFrame: Frame | null = null;
    try {
      // Compute frame: same atom positions as Particles, domain = AABB
      // with pbc=false so kernels never fold into the crystal cell.
      computeFrame = new MolrsFrame();
      computeFrame.box = new Box(h, origin, false, false, false);
      const cAtoms = computeFrame.createBlock("atoms");
      cAtoms.setColF("x", Float64Array.from(coords.x));
      cAtoms.setColF("y", Float64Array.from(coords.y));
      cAtoms.setColF("z", Float64Array.from(coords.z));

      gd = new WasmGaussianDensity(
        this._nx,
        this._ny,
        this._nz,
        this._sigma,
        this._rMax,
      );
      const raw = gd.compute(computeFrame);
      if (!isGrid3Out(raw)) {
        logger.warn(
          "[Gaussian density surface] unexpected compute payload; skip draw",
        );
        return input;
      }
      const [nx, ny, nz] = raw.shape;
      const data =
        raw.data instanceof Float64Array
          ? raw.data
          : Float64Array.from(raw.data);

      if (this._isovalueAuto) {
        let maxAbs = 0;
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i]);
          if (a > maxAbs) maxAbs = a;
        }
        this._style = {
          ...this._style,
          isovalue: maxAbs > 0 ? maxAbs * 0.1 : 0.05,
        };
      }

      // Draw frame: same non-periodic domain so isosurface MC stays
      // "general" (no periodic seam) and co-located with atoms.
      drawFrame = new MolrsFrame();
      drawFrame.box = new Box(
        new Float64Array(h),
        new Float64Array(origin),
        false,
        false,
        false,
      );
      const grid = drawFrame.createBlock("grid");
      grid.setColF("density", data);
      grid.setShape(new Uint32Array([nx, ny, nz]));

      ctx.app.artist.drawIsosurface(drawFrame, this._style);
    } catch (err) {
      logger.warn(
        "[Gaussian density surface] compute/draw failed",
        err as Error,
      );
    } finally {
      gd?.free();
      computeFrame?.free();
      drawFrame?.free();
    }
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    app.artist.isosurfaceRenderer.setVisible(visible);
  }
}
