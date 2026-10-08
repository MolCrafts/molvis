/**
 * Molecular surface — the envelope of a molecule, computed from its atoms.
 *
 * One modifier, several algorithms. The input contract is what defines the
 * modifier: **atoms in, surface out**. A step that needs a volumetric grid
 * from a CUBE/CHGCAR/XSF file is not this modifier — that is
 * {@link ../pipeline/draw_isosurface DrawIsosurfaceModifier}.
 *
 * | Algorithm  | Field                                       |
 * |------------|---------------------------------------------|
 * | `vdw`      | union of van der Waals balls                |
 * | `sas`      | solvent-accessible: balls grown by the probe|
 * | `ses`      | solvent-excluded (Connolly): probe rolled   |
 * | `gaussian` | molrs Gaussian density, meshed at an isovalue|
 * | `hull`     | convex envelope of the van der Waals spheres |
 * | `alpha`    | alpha shape: Delaunay tetrahedra smaller than α |
 *
 * The field algorithms produce a scalar field that is **positive inside**, so
 * the solvent modes mesh at 0 while `gaussian` meshes at its own isovalue;
 * hull and alpha shape emit triangles directly. Either way the output is one
 * {@link SurfaceMesh}, published for the paired
 * {@link ../pipeline/draw_surface Draw surface} step to paint.
 *
 * This modifier computes; it does not draw. Colour and opacity live on the
 * draw step, so restyling a surface never re-runs marching cubes — or, for
 * alpha shape, a Delaunay tetrahedralisation.
 *
 * The field domain is the atom AABB + pad with `pbc = false`, never
 * `frame.box`: depositing on the crystal cell folds ASU atoms into the
 * primary cell while Particles still draw at deposited Cartn — the "surface
 * wrapped, protein not" bug. See `.claude/notes/open-questions.md`.
 *
 * Does not mutate the pipeline frame, and never auto-attaches: a molecular
 * surface is opt-in Visualization.
 */

import {
  Box,
  type Frame,
  GaussianDensity,
  Frame as MolrsFrame,
} from "@molcrafts/molvis-core/molrs";
import { marchingCubes } from "../algo/marching_cubes";
import { AlphaShape } from "../algo/surface/alpha_shape";
import { GridDomain } from "../algo/surface/grid_domain";
import { HullSurface } from "../algo/surface/hull_surface";
import {
  SolventSurface,
  type SolventSurfaceMode,
} from "../algo/surface/solvent_surface";
import { primaryPart, type SurfaceMesh } from "../algo/surface_mesh";
import { viewAtomCoords } from "../io/atom_coords";
import { DrawSurfaceModifier } from "../pipeline/draw_surface";
import {
  BaseModifier,
  type GeometryProducer,
  ModifierCapability,
} from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { type ProjectParams, readEnum, readNumber } from "../project/params";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";

export const SURFACE_ALGORITHMS = [
  "vdw",
  "sas",
  "ses",
  "gaussian",
  "hull",
  "alpha",
] as const;

export type SurfaceAlgorithm = (typeof SURFACE_ALGORITHMS)[number];

/** Algorithms that emit triangles directly, with no grid in between. */
export type MeshAlgorithm = "hull" | "alpha";

export function isMeshAlgorithm(
  algorithm: SurfaceAlgorithm,
): algorithm is MeshAlgorithm {
  return algorithm === "hull" || algorithm === "alpha";
}

/** Shared by `vdw` / `sas` / `ses`; `vdw` ignores `probeRadius`. */
export interface SolventSurfaceParams {
  /** Voxel spacing, Å. */
  readonly resolution: number;
  /** Solvent probe radius, Å. 1.4 is water. */
  readonly probeRadius: number;
  /** Multiplier on tabulated van der Waals radii. */
  readonly radiusScale: number;
}

export interface GaussianSurfaceParams {
  /** Voxel spacing, Å. */
  readonly resolution: number;
  /** Gaussian kernel width, Å. */
  readonly sigma: number;
  /** Kernel truncation radius, Å. `null` lets molrs choose. */
  readonly cutoff: number | null;
  /**
   * Level set to mesh. `null` picks a tenth of the peak on each run.
   *
   * A compute parameter, not a style one: moving it moves the geometry. The
   * solvent and geometric algorithms have no equivalent — their surface is
   * defined by radii, not by a threshold.
   */
  readonly isovalue: number | null;
}

export const DEFAULT_SOLVENT_PARAMS: SolventSurfaceParams = {
  resolution: 0.5,
  probeRadius: 1.4,
  radiusScale: 1,
};

export interface AlphaShapeParams {
  /** Probe sphere radius α, Å. Tetrahedra smaller than this are solid. */
  readonly probeRadius: number;
  /** Smoothing passes over the extracted surface. 0 leaves raw facets. */
  readonly smoothing: number;
}

/**
 * Delaunay runs on the main thread and costs about 2.8 s at this size on a
 * current laptop, rising steeply after; past it the freeze reads as a hang.
 * Measured on a uniform random cloud at protein density.
 */
export const MAX_ALPHA_SHAPE_ATOMS = 20_000;

export const DEFAULT_ALPHA_PARAMS: AlphaShapeParams = {
  probeRadius: 3,
  smoothing: 2,
};

export const DEFAULT_GAUSSIAN_PARAMS: GaussianSurfaceParams = {
  resolution: 0.5,
  sigma: 1,
  cutoff: null,
  isovalue: null,
};

/** What a builder hands back for meshing. */
interface SurfaceField {
  origin: Float64Array;
  cell: Float64Array;
  shape: [number, number, number];
  values: Float64Array;
  isovalue: number;
}

interface AtomInput {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  count: number;
  elements?: string[];
}

export class MolecularSurfaceModifier
  extends BaseModifier
  implements GeometryProducer
{
  static readonly NAME = "Molecular surface";

  private _algorithm: SurfaceAlgorithm = "ses";
  private _solvent: SolventSurfaceParams = DEFAULT_SOLVENT_PARAMS;
  private _gaussian: GaussianSurfaceParams = DEFAULT_GAUSSIAN_PARAMS;
  private _alpha: AlphaShapeParams = DEFAULT_ALPHA_PARAMS;
  private _lastReport: SurfaceReport | null = null;

  constructor(id = "molecular-surface") {
    super(
      id,
      MolecularSurfaceModifier.NAME,
      new Set([ModifierCapability.ProducesGeometry]),
    );
  }

  createDraw(): DrawSurfaceModifier {
    return new DrawSurfaceModifier("draw-surface", this.id);
  }

  get algorithm(): SurfaceAlgorithm {
    return this._algorithm;
  }
  get solventParams(): SolventSurfaceParams {
    return this._solvent;
  }
  get gaussianParams(): GaussianSurfaceParams {
    return this._gaussian;
  }
  get alphaParams(): AlphaShapeParams {
    return this._alpha;
  }
  /** What the last run actually did — grid shape, clamping, radius fallback. */
  get report(): SurfaceReport | null {
    return this._lastReport;
  }

  /**
   * Switching algorithm keeps every algorithm's own parameters, so flipping
   * back and forth is lossless.
   */
  setAlgorithm(algorithm: SurfaceAlgorithm): void {
    this._algorithm = algorithm;
  }

  setSolventParams(patch: Partial<SolventSurfaceParams>): void {
    this._solvent = { ...this._solvent, ...patch };
  }

  setGaussianParams(patch: Partial<GaussianSurfaceParams>): void {
    this._gaussian = { ...this._gaussian, ...patch };
  }

  setAlphaParams(patch: Partial<AlphaShapeParams>): void {
    this._alpha = { ...this._alpha, ...patch };
  }

  /**
   * Persisted across project save/load and backend state-sync. Without this
   * the modifier would rebuild from the registry defaults, so a surface saved
   * as SES would reload as the default algorithm — see
   * {@link ../project/params}.
   */
  toProjectParams(): ProjectParams {
    return {
      algorithm: this._algorithm,
      solvent: { ...this._solvent },
      gaussian: { ...this._gaussian },
      alpha: { ...this._alpha },
    };
  }

  fromProjectParams(params: ProjectParams): void {
    this._algorithm = readEnum(
      params.algorithm,
      SURFACE_ALGORITHMS,
      this._algorithm,
    );

    const solvent = asRecord(params.solvent);
    this._solvent = {
      resolution: readNumber(solvent.resolution, this._solvent.resolution),
      probeRadius: readNumber(solvent.probeRadius, this._solvent.probeRadius),
      radiusScale: readNumber(solvent.radiusScale, this._solvent.radiusScale),
    };

    const gaussian = asRecord(params.gaussian);
    this._gaussian = {
      resolution: readNumber(gaussian.resolution, this._gaussian.resolution),
      sigma: readNumber(gaussian.sigma, this._gaussian.sigma),
      cutoff:
        typeof gaussian.cutoff === "number" && Number.isFinite(gaussian.cutoff)
          ? gaussian.cutoff
          : null,
      // null is meaningful: it means "keep picking automatically".
      isovalue:
        typeof gaussian.isovalue === "number" &&
        Number.isFinite(gaussian.isovalue)
          ? gaussian.isovalue
          : null,
    };

    const alpha = asRecord(params.alpha);
    this._alpha = {
      probeRadius: readNumber(alpha.probeRadius, this._alpha.probeRadius),
      smoothing: readNumber(alpha.smoothing, this._alpha.smoothing),
    };
  }

  /** Surfaces are opt-in Visualization, never a default layer. */
  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    return atoms !== undefined && atoms.nRows > 0;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._algorithm}:${this.paramsCacheKey()}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    if (!atoms || atoms.nRows === 0) return input;

    const coords = viewAtomCoords(atoms);
    if (!coords) {
      logger.warn("[Molecular surface] frame has no x/y/z columns; skip draw");
      return input;
    }
    // Copy before any further WASM call: the coord views are zero-copy into
    // linear memory and a later call may grow (and detach) that buffer.
    const atomInput: AtomInput = {
      x: Float64Array.from(coords.x),
      y: Float64Array.from(coords.y),
      z: Float64Array.from(coords.z),
      count: atoms.nRows,
      elements:
        atoms.has("element") && atoms.dtype("element") === DType.String
          ? (atoms.copy("element") as string[])
          : undefined,
    };

    const algorithm = this._algorithm;
    try {
      const mesh = isMeshAlgorithm(algorithm)
        ? this.buildMeshAlgorithm(algorithm, atomInput)
        : this.buildFieldMesh(algorithm, atomInput);
      ctx.surfaces.set(this.id, mesh ? primaryPart(mesh) : []);
    } catch (err) {
      logger.warn("[Molecular surface] compute failed", err as Error);
      ctx.surfaces.set(this.id, []);
    }
    return input;
  }

  /**
   * Field algorithms mesh their own level set. Marching cubes runs here
   * rather than in the renderer so that every algorithm hands the draw step
   * the same thing — triangles — whatever it did upstream.
   */
  private buildFieldMesh(
    algorithm: Exclude<SurfaceAlgorithm, MeshAlgorithm>,
    atoms: AtomInput,
  ): SurfaceMesh | null {
    const field =
      algorithm === "gaussian"
        ? this.buildGaussianField(atoms)
        : this.buildSolventField(atoms, algorithm);
    if (!field) return null;
    return marchingCubes(
      field.values,
      field.shape,
      field.cell,
      field.origin,
      field.isovalue,
      // The domain is the atom AABB with pbc = false, so a boundary-wrapping
      // pass would seam the surface across empty space.
      "general",
    );
  }

  private paramsCacheKey(): string {
    if (this._algorithm === "gaussian") {
      const g = this._gaussian;
      return `r=${g.resolution}:σ=${g.sigma}:c=${g.cutoff ?? "auto"}:iv=${g.isovalue ?? "auto"}`;
    }
    if (this._algorithm === "alpha") {
      return `a=${this._alpha.probeRadius}:sm=${this._alpha.smoothing}`;
    }
    const v = this._solvent;
    return `r=${v.resolution}:p=${v.probeRadius}:s=${v.radiusScale}`;
  }

  private buildMeshAlgorithm(
    algorithm: MeshAlgorithm,
    atoms: AtomInput,
  ): SurfaceMesh | null {
    return algorithm === "alpha"
      ? this.buildAlphaShape(atoms)
      : this.buildHull(atoms);
  }

  private buildAlphaShape(atoms: AtomInput): SurfaceMesh | null {
    if (atoms.count > MAX_ALPHA_SHAPE_ATOMS) {
      this._lastReport = {
        shape: null,
        spacing: null,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: true,
        triangleCount: 0,
        tooManyAtoms: atoms.count,
      };
      logger.warn(
        `[Molecular surface] alpha shape needs a Delaunay tetrahedralisation; ${atoms.count} atoms exceeds the ${MAX_ALPHA_SHAPE_ATOMS} limit`,
      );
      return null;
    }

    const shape = new AlphaShape(atoms, {
      probeRadius: this._alpha.probeRadius,
      smoothing: this._alpha.smoothing,
    });
    this._lastReport = {
      shape: null,
      spacing: null,
      resolutionClamped: false,
      usedFallbackRadius: false,
      degenerate: shape.degenerate,
      triangleCount: shape.triangleCount,
      tooManyAtoms: null,
    };
    if (shape.degenerate) {
      logger.warn(
        "[Molecular surface] no tetrahedron survived the alpha filter; raise the probe radius",
      );
      return null;
    }
    return shape.mesh;
  }

  private buildHull(atoms: AtomInput): SurfaceMesh | null {
    const hull = new HullSurface(atoms, {
      radiusScale: this._solvent.radiusScale,
    });
    this._lastReport = {
      shape: null,
      spacing: null,
      resolutionClamped: false,
      usedFallbackRadius: hull.usedFallbackRadius,
      degenerate: hull.degenerate,
      triangleCount: hull.mesh.indices.length / 3,
      tooManyAtoms: null,
    };
    if (hull.degenerate) {
      logger.warn(
        "[Molecular surface] atoms do not span a volume; convex hull has nothing to enclose",
      );
      return null;
    }
    return hull.mesh;
  }

  private buildSolventField(
    atoms: AtomInput,
    mode: SolventSurfaceMode,
  ): SurfaceField {
    const surface = new SolventSurface(atoms, {
      mode,
      resolution: this._solvent.resolution,
      probeRadius: this._solvent.probeRadius,
      radiusScale: this._solvent.radiusScale,
    });
    const { domain } = surface;
    this._lastReport = {
      shape: domain.shape,
      spacing: domain.spacing,
      resolutionClamped: surface.clamped,
      usedFallbackRadius: surface.usedFallbackRadius,
      degenerate: false,
      triangleCount: null,
      tooManyAtoms: null,
    };
    return {
      origin: domain.origin,
      cell: domain.cell,
      shape: domain.shape,
      values: surface.values,
      // The solvent envelopes are defined by their radii, not by a threshold.
      isovalue: 0,
    };
  }

  private buildGaussianField(atoms: AtomInput): SurfaceField | null {
    const { resolution, sigma, cutoff } = this._gaussian;
    const domain = new GridDomain(atoms.x, atoms.y, atoms.z, atoms.count, {
      pad: Math.max(3 * sigma, cutoff ?? 0, 1),
      spacing: resolution,
    });

    let density: GaussianDensity | null = null;
    let computeFrame: Frame | null = null;
    try {
      // Same atom positions as Particles, on a non-periodic domain so the
      // kernel never folds contributions into the crystal cell.
      computeFrame = new MolrsFrame();
      computeFrame.box = new Box(
        new Float64Array(domain.cell),
        new Float64Array(domain.origin),
        false,
        false,
        false,
      );
      const block = computeFrame.createBlock("atoms");
      block.set("x", atoms.x);
      block.set("y", atoms.y);
      block.set("z", atoms.z);

      density = new GaussianDensity(
        domain.nx,
        domain.ny,
        domain.nz,
        sigma,
        cutoff,
      );
      const raw = density.compute(computeFrame);
      const values = readGrid3(raw);
      if (!values) {
        logger.warn(
          "[Molecular surface] unexpected density payload; skip draw",
        );
        return null;
      }

      this._lastReport = {
        shape: domain.shape,
        spacing: domain.spacing,
        resolutionClamped: domain.clamped,
        usedFallbackRadius: false,
        degenerate: false,
        triangleCount: null,
        tooManyAtoms: null,
      };
      const isovalue = this._gaussian.isovalue ?? autoIsovalue(values.data);
      return {
        origin: domain.origin,
        cell: domain.cell,
        shape: values.shape,
        values: values.data,
        isovalue,
      };
    } finally {
      density?.free();
      computeFrame?.free();
    }
  }
}

/** What the last run did, for the panel's derived caption and alerts. */
export interface SurfaceReport {
  /** Grid shape, or `null` for the algorithms that never build a grid. */
  shape: [number, number, number] | null;
  /** Voxel spacing in Å, or `null` when there is no grid. */
  spacing: number | null;
  resolutionClamped: boolean;
  usedFallbackRadius: boolean;
  /** True when the atoms could not span a volume, so nothing was drawn. */
  degenerate: boolean;
  /** Triangles drawn, for the algorithms that report a mesh directly. */
  triangleCount: number | null;
  /** Atom count when the run was refused for being too large; else null. */
  tooManyAtoms: number | null;
}

interface Grid3 {
  data: Float64Array;
  shape: [number, number, number];
}

/** Validate the untyped `grid3` payload molrs returns from `compute()`. */
function readGrid3(raw: unknown): Grid3 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { data?: unknown; shape?: unknown };
  if (!Array.isArray(o.shape) || o.shape.length !== 3) return null;
  if (!Array.isArray(o.data) && !ArrayBuffer.isView(o.data)) return null;
  const data =
    o.data instanceof Float64Array
      ? o.data
      : Float64Array.from(o.data as ArrayLike<number>);
  return { data, shape: o.shape as [number, number, number] };
}

/** A tenth of the peak: dense enough to read as a molecule, not a blob. */
function autoIsovalue(data: Float64Array): number {
  let maxAbs = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > maxAbs) maxAbs = a;
  }
  return maxAbs > 0 ? maxAbs * 0.1 : 0.05;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
