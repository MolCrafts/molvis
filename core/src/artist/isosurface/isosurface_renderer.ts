/**
 * IsosurfaceRenderer — holds the BabylonJS meshes produced by Marching
 * Cubes from a frame's volumetric `"grid"` block.
 *
 * Driven by `DrawIsosurfaceModifier.apply()` via `Artist.drawIsosurface()`.
 * Each call to `rebuild(frame, style)` tears down the previous mesh(es)
 * and re-extracts the surface at the requested isovalue/channel. When
 * `style.showNegative` is on, two meshes are produced: one for `+iso`
 * (drawn in `style.color`) and one for `-iso` (drawn in a contrasting
 * complement). This is the common workflow for orbital ψ and spin
 * difference (`diff`) channels.
 *
 * The mesh is registered as `isPickable = false` — picking through an
 * isosurface should still hit the underlying atoms (same convention as
 * `sim_box`).
 */

import {
  Constants,
  Material,
  Mesh,
  type Scene,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Frame } from "@molcrafts/molrs";
import { type MCMesh, marchingCubes } from "../../algo/marching_cubes";
import { logger } from "../../utils/logger";

/**
 * How to display the volumetric field.
 *  - "surface": marching-cubes triangle mesh (closed iso surface)
 *  - "cloud":   per-voxel point sprites colored by magnitude
 *  - "both":    surface + cloud, useful when you want the lobes plus
 *               a sense of the underlying density distribution.
 */
export type IsosurfaceRenderMode = "surface" | "cloud" | "both";

/** Channel selector + visual parameters for a single isosurface modifier. */
export interface IsosurfaceStyle {
  /** Scalar threshold. Stored as a positive value; sign is implied by mesh kind. */
  isovalue: number;
  /** Linear RGB triple in [0, 1] for the positive iso. */
  color: [number, number, number];
  /** 0..1 alpha. Below 1 enables alpha blending. */
  opacity: number;
  /** Grid block column to extract (e.g. "density", "total", "diff", "mo_6"). */
  channel: string;
  /** When true, draw both `+iso` and `-iso` (orbitals, spin difference). */
  showNegative: boolean;
  /** See {@link IsosurfaceRenderMode}. */
  renderMode: IsosurfaceRenderMode;
  /** Cloud-only: hide voxels with `|value| < cloudThreshold * max|v|`. */
  cloudThreshold: number;
  /** Cloud-only: sample every Nth voxel (1 = full density, larger = sparser). */
  cloudStride: number;
  /**
   * When the simbox is periodic, also draw the cloud at ±a, ±b, ±c cell
   * images so the user sees the surrounding crystal context (mirrors
   * the convention used for ghost-atom rendering).
   */
  showPbcImages: boolean;
}

export const DEFAULT_ISOSURFACE_STYLE: IsosurfaceStyle = {
  isovalue: 0.05,
  color: [0.4, 0.65, 1.0],
  opacity: 0.6,
  channel: "density",
  showNegative: false,
  renderMode: "surface",
  cloudThreshold: 0.08,
  cloudStride: 1,
  showPbcImages: false,
};

export const ISOSURFACE_MESH_NAME = "isosurface";
export const ISOSURFACE_MESH_NAME_NEG = "isosurface_neg";
export const ISOSURFACE_CLOUD_MESH_NAME = "isosurface_cloud";

/**
 * Pick a default isovalue from the channel statistics. Conservative
 * defaults that match common community settings:
 *   - charge density (`density`, `total`): 5% of max(|v|)
 *   - orbitals (`mo_*`): 4% of max(|v|), with the ±iso pair on
 *   - spin difference (`diff`): 2% of max(|v|), ±iso pair on
 */
export function defaultIsovalueFor(
  channel: string,
  data: Float64Array | ArrayLike<number>,
): number {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > max) max = v;
  }
  if (channel === "diff") return 0.02 * max;
  if (channel.startsWith("mo_")) return 0.04 * max;
  // density / total / unknown
  return 0.05 * max;
}

/** Channel suggests signed data (orbitals, spin difference). */
export function channelIsSigned(channel: string): boolean {
  return channel === "diff" || channel.startsWith("mo_");
}

/**
 * Free a `WasmArray` after copying its bytes into a JS-owned typed
 * array. Mirrors `artist.copyAndFree` so the renderer can stay in its
 * own module without importing private helpers.
 */
function copyAndFreeF64(wa: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return wa.toCopy();
  } finally {
    wa.free();
  }
}

export class IsosurfaceRenderer {
  private scene: Scene;
  private posMesh: Mesh | null = null;
  private negMesh: Mesh | null = null;
  private cloudMesh: Mesh | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** True iff at least one mesh is currently installed in the scene. */
  public get hasData(): boolean {
    return (
      this.posMesh !== null || this.negMesh !== null || this.cloudMesh !== null
    );
  }

  /**
   * Rebuild meshes from `frame` for `style`. Safe to call repeatedly;
   * stale meshes are disposed first.
   *
   * Returns silently if the frame lacks the requested grid block, the
   * channel, or a simbox — the modifier's `matches()` already gates
   * against this, but we double-check so a partial frame can't crash
   * the renderer.
   */
  public rebuild(frame: Frame, style: IsosurfaceStyle): void {
    this.dispose();

    const grid = frame.getBlock("grid");
    if (!grid) {
      logger.warn("[Isosurface] frame has no 'grid' block; nothing to draw");
      return;
    }
    const shape = grid.shape();
    if (shape.length !== 3) {
      logger.warn(
        `[Isosurface] grid block is not 3-D (shape length ${shape.length}); nothing to draw`,
      );
      return;
    }
    const [nx, ny, nz] = [shape[0], shape[1], shape[2]];

    // Marching cubes operates on (nx-1)·(ny-1)·(nz-1) cells. Any axis
    // with size < 2 yields zero cells, so the "general" grid type can't
    // produce any geometry at all. Catch this up front rather than
    // letting the user blame the isovalue.
    if (nx < 2 || ny < 2 || nz < 2) {
      logger.warn(
        `[Isosurface] grid shape [${nx},${ny},${nz}] has an axis < 2; marching cubes needs at least 2×2×2 for a single cell. This is usually a hand-crafted threshold-test fixture (e.g. valtest.cube), not a real volumetric file.`,
      );
      return;
    }

    let data: Float64Array | undefined;
    try {
      data = grid.copyColF(style.channel);
    } catch (err) {
      logger.warn(
        `[Isosurface] grid has no '${style.channel}' column (available: ${grid.keys().join(", ")}); nothing to draw`,
        err as Error,
      );
      return;
    }
    if (!data) return;

    const box = frame.simbox;
    if (!box) {
      logger.warn(
        "[Isosurface] frame has no simbox; cannot place voxels in world space",
      );
      return;
    }

    const cell = copyAndFreeF64(box.hMatrix());
    const origin = copyAndFreeF64(box.origin());

    // PBC awareness: marching cubes can wrap cells across the cell
    // boundary when the simbox is fully periodic (CHGCAR, MD-style).
    // Cube files declare non-periodic boxes, so they take the "general"
    // path which leaves a sealed-at-boundary mesh — correct for finite
    // voxel cells. Mixed PBC (slab geometry) currently falls back to
    // "general" since marching_cubes' periodic mode is all-or-nothing.
    const pbc = box.pbc();
    const allPeriodic = pbc[0] === 1 && pbc[1] === 1 && pbc[2] === 1;
    const gridType: "general" | "periodic" = allPeriodic
      ? "periodic"
      : "general";

    // Log a one-line summary so it's clear what's being rendered.
    let dataMin = data[0];
    let dataMax = data[0];
    for (let i = 1; i < data.length; i++) {
      const v = data[i];
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
    logger.info(
      `[Isosurface] mode='${style.renderMode}' channel='${style.channel}' shape=[${nx},${ny},${nz}] iso=${style.isovalue.toExponential(3)} data∈[${dataMin.toExponential(3)}, ${dataMax.toExponential(3)}] cellLen=[${Math.hypot(cell[0], cell[1], cell[2]).toFixed(2)}, ${Math.hypot(cell[3], cell[4], cell[5]).toFixed(2)}, ${Math.hypot(cell[6], cell[7], cell[8]).toFixed(2)}]Å pbc=[${pbc[0]},${pbc[1]},${pbc[2]}] grid=${gridType}`,
    );

    const wantSurface =
      style.renderMode === "surface" || style.renderMode === "both";
    const wantCloud =
      style.renderMode === "cloud" || style.renderMode === "both";

    if (wantSurface) {
      const posMcMesh = marchingCubes(
        data,
        [nx, ny, nz],
        cell,
        origin,
        style.isovalue,
        gridType,
      );
      this.posMesh = this.installMesh(
        ISOSURFACE_MESH_NAME,
        posMcMesh,
        style.color,
        style.opacity,
      );
      if (!this.posMesh) {
        logger.warn(
          `[Isosurface] +iso=${style.isovalue.toExponential(3)} produced no triangles (data range [${dataMin.toExponential(3)}, ${dataMax.toExponential(3)}]); try lowering the isovalue or switching channel`,
        );
      } else {
        logger.info(
          `[Isosurface] +iso mesh: ${posMcMesh.positions.length / 3} verts, ${posMcMesh.indices.length / 3} tris`,
        );
      }

      if (style.showNegative) {
        const negMcMesh = marchingCubes(
          data,
          [nx, ny, nz],
          cell,
          origin,
          -style.isovalue,
          gridType,
        );
        const negColor: [number, number, number] = [
          1 - style.color[0],
          1 - style.color[1],
          1 - style.color[2],
        ];
        this.negMesh = this.installMesh(
          ISOSURFACE_MESH_NAME_NEG,
          negMcMesh,
          negColor,
          style.opacity,
        );
        if (this.negMesh) {
          logger.info(
            `[Isosurface] -iso mesh: ${negMcMesh.positions.length / 3} verts, ${negMcMesh.indices.length / 3} tris`,
          );
        }
      }
    }

    if (wantCloud) {
      this.cloudMesh = this.buildCloudMesh(
        data,
        [nx, ny, nz],
        cell,
        origin,
        style,
        allPeriodic,
      );
    }
  }

  /**
   * Build the per-voxel point cloud. Voxel at `(ix,iy,iz)` is placed at
   * world position `origin + (ix/nx)*a + (iy/ny)*b + (iz/nz)*c` — same
   * convention as marching cubes' fracToWorld, so it stays inside the
   * simbox by construction.
   *
   * When the simbox is fully periodic and `style.showPbcImages` is on,
   * we replicate the cloud at the 26 neighboring cell images (a 3×3×3
   * super-cell minus the center) so the user sees the surrounding
   * crystal context — same idea as ghost-atom rendering.
   *
   * Color encodes magnitude (saturated at the channel's max|v|), alpha
   * encodes magnitude × style opacity. Negative-magnitude voxels are
   * colored toward the negative-iso complement so signed channels read
   * correctly.
   */
  private buildCloudMesh(
    data: Float64Array,
    shape: [number, number, number],
    cell: Float64Array,
    origin: Float64Array,
    style: IsosurfaceStyle,
    allPeriodic: boolean,
  ): Mesh | null {
    const [nx, ny, nz] = shape;

    let maxAbs = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > maxAbs) maxAbs = v;
    }
    if (maxAbs === 0) {
      logger.warn(
        "[Isosurface] cloud: channel is identically zero, nothing to draw",
      );
      return null;
    }

    const stride = Math.max(1, Math.floor(style.cloudStride));
    const threshold = style.cloudThreshold * maxAbs;
    const negComplement: [number, number, number] = [
      1 - style.color[0],
      1 - style.color[1],
      1 - style.color[2],
    ];
    const baseAlpha = Math.max(0.05, Math.min(1, style.opacity));

    // PBC image offsets: the primary cell plus, optionally, every
    // adjacent image that the simbox declares periodic.
    const imageOffsets: Array<[number, number, number]> =
      style.showPbcImages && allPeriodic ? this.pbcImageOffsets() : [[0, 0, 0]];

    const positions: number[] = [];
    const colors: number[] = [];

    const at = (ix: number, iy: number, iz: number) =>
      ix * ny * nz + iy * nz + iz;

    for (const [da, db, dc] of imageOffsets) {
      // Pre-compute per-image cell offset (da*a + db*b + dc*c).
      const ox = origin[0] + da * cell[0] + db * cell[3] + dc * cell[6];
      const oy = origin[1] + da * cell[1] + db * cell[4] + dc * cell[7];
      const oz = origin[2] + da * cell[2] + db * cell[5] + dc * cell[8];

      for (let ix = 0; ix < nx; ix += stride) {
        for (let iy = 0; iy < ny; iy += stride) {
          for (let iz = 0; iz < nz; iz += stride) {
            const v = data[at(ix, iy, iz)];
            const mag = Math.abs(v);
            if (mag < threshold) continue;

            const fx = ix / nx;
            const fy = iy / ny;
            const fz = iz / nz;
            positions.push(
              ox + fx * cell[0] + fy * cell[3] + fz * cell[6],
              oy + fx * cell[1] + fy * cell[4] + fz * cell[7],
              oz + fx * cell[2] + fy * cell[5] + fz * cell[8],
            );

            const t = Math.min(1, mag / maxAbs);
            const tint = v >= 0 ? style.color : negComplement;
            colors.push(
              tint[0] * (0.4 + 0.6 * t),
              tint[1] * (0.4 + 0.6 * t),
              tint[2] * (0.4 + 0.6 * t),
              baseAlpha * (0.3 + 0.7 * t),
            );
          }
        }
      }
    }

    if (positions.length === 0) {
      logger.warn(
        `[Isosurface] cloud: threshold ${style.cloudThreshold} eliminated every voxel; lower the threshold to see points`,
      );
      return null;
    }

    const mesh = new Mesh(ISOSURFACE_CLOUD_MESH_NAME, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.colors = colors;
    vd.applyToMesh(mesh, true);

    const mat = new StandardMaterial(
      `${ISOSURFACE_CLOUD_MESH_NAME}_mat`,
      this.scene,
    );
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 1, 1); // colors come from per-vertex
    mat.pointsCloud = true;
    // Spacing-aware point size: use the smallest voxel pitch so points
    // are distinguishable but not overlapping in the dense regions.
    const pitchA = Math.hypot(cell[0], cell[1], cell[2]) / nx;
    const pitchB = Math.hypot(cell[3], cell[4], cell[5]) / ny;
    const pitchC = Math.hypot(cell[6], cell[7], cell[8]) / nz;
    const pitch = Math.min(pitchA, pitchB, pitchC);
    mat.pointSize = Math.max(2, Math.min(8, pitch * 6));
    // Additive alpha blending + NO depth write. The cloud is a "glow"
    // overlay: points accumulate color into the framebuffer but must
    // never occlude atoms or bonds behind them. Without
    // `disableDepthWrite`, Babylon's pointsCloud rasterizer still
    // writes a depth value at each visible point — those depth writes
    // then make any geometry rendered after the cloud (or even atoms,
    // depending on render order) fail the depth test from camera
    // angles where points cover atom positions in screen space.
    //
    // Setting `disableDepthWrite = true` cleanly removes the cloud
    // from the depth occlusion graph; combined with ALPHA_ADD, points
    // are order-independent, occlusion-free, and depth-precision-safe.
    mat.alpha = 1.0;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.needDepthPrePass = false;
    mat.separateCullingPass = false;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.disableDepthWrite = true;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // Force the cloud to render *first* in the alpha-blend pass so
    // atoms (also alpha-blended via the impostor shader) always paint
    // on top. Without this, Babylon's back-to-front sort can flip with
    // camera angle and put the cloud after atoms — at which point a
    // pile of overlapping additive point sprites saturates the pixel
    // and visually wipes the atom from screen even though it's still
    // there in the depth buffer.
    //
    // alphaIndex defaults to Number.MAX_VALUE; lower = earlier. Use 0
    // so the cloud sorts before everything else transparent.
    mesh.alphaIndex = 0;

    logger.info(
      `[Isosurface] cloud: ${positions.length / 3} points across ${imageOffsets.length} cell image(s)`,
    );
    return mesh;
  }

  /** Offsets for primary cell + 26 PBC neighbors (3×3×3 super-cell). */
  private pbcImageOffsets(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        for (let dc = -1; dc <= 1; dc++) {
          out.push([da, db, dc]);
        }
      }
    }
    return out;
  }

  public setVisible(visible: boolean): void {
    this.posMesh?.setEnabled(visible);
    this.negMesh?.setEnabled(visible);
    this.cloudMesh?.setEnabled(visible);
  }

  /**
   * Live opacity update without re-running marching cubes. The surface
   * meshes use the standard alpha-blend pipeline; the cloud mesh uses
   * additive blending (no depth pre-pass) so we tweak its color
   * intensity instead of the material alpha — calling `applyOpacity`
   * on the cloud would re-enable `needDepthPrePass` and make atoms
   * behind the cloud disappear at certain camera angles.
   */
  public setOpacity(opacity: number): void {
    for (const mesh of [this.posMesh, this.negMesh]) {
      if (!mesh) continue;
      const mat = mesh.material as StandardMaterial | null;
      if (mat) this.applyOpacity(mat, opacity);
    }
    // Cloud opacity slider is reflected on next pipeline rebuild —
    // keeping additive cloud blending stable trumps live cloud opacity.
  }

  public dispose(): void {
    for (const meshRef of [
      { mesh: this.posMesh, name: "posMesh" as const },
      { mesh: this.negMesh, name: "negMesh" as const },
      { mesh: this.cloudMesh, name: "cloudMesh" as const },
    ]) {
      if (meshRef.mesh) {
        meshRef.mesh.material?.dispose();
        meshRef.mesh.dispose();
      }
    }
    this.posMesh = null;
    this.negMesh = null;
    this.cloudMesh = null;
  }

  private installMesh(
    name: string,
    mc: MCMesh,
    color: [number, number, number],
    opacity: number,
  ): Mesh | null {
    if (mc.positions.length === 0 || mc.indices.length === 0) {
      return null;
    }
    const mesh = new Mesh(name, this.scene);

    const vertexData = new VertexData();
    vertexData.positions = mc.positions;
    vertexData.normals = mc.normals;
    vertexData.indices = mc.indices;
    vertexData.applyToMesh(mesh);

    const mat = new StandardMaterial(`${name}_mat`, this.scene);
    mat.backFaceCulling = false;
    mat.diffuseColor = new Color3(color[0], color[1], color[2]);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.specularPower = 32;
    mat.ambientColor = new Color3(0.35, 0.35, 0.4);
    this.applyOpacity(mat, opacity);
    mesh.material = mat;

    mesh.isPickable = false;
    return mesh;
  }

  private applyOpacity(mat: StandardMaterial, opacity: number): void {
    const a = Math.max(0, Math.min(1, opacity));
    mat.alpha = a;
    if (a < 1) {
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.needDepthPrePass = true;
      mat.separateCullingPass = true;
    } else {
      mat.transparencyMode = Material.MATERIAL_OPAQUE;
      mat.needDepthPrePass = false;
      mat.separateCullingPass = false;
    }
  }
}
