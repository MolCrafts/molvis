/**
 * Voxel point-sprite cloud for a volumetric grid.
 *
 * Split out of the old isosurface renderer when surfaces became a uniform
 * triangle-mesh pipeline: a cloud is emphatically not a surface — it samples
 * the field everywhere rather than extracting one level set — so it could not
 * ride the shared `Draw surface` path and became its own draw step instead.
 * `renderMode: "both"` is now simply both modifiers in the pipeline, which is
 * the more composable arrangement anyway.
 *
 * Additive blending with `disableDepthWrite` is load-bearing, not a
 * preference: see the note inside {@link VolumeCloudRenderer.build}.
 */

import {
  Constants,
  Material,
  Mesh,
  type Scene,
  ShaderMaterial,
  VertexData,
} from "@babylonjs/core";
import { logger } from "../../utils/logger";

export const CLOUD_MESH_NAME = "volume_cloud";

export interface VolumeCloudStyle {
  /** Linear RGB in [0, 1]; negative values paint toward the complement. */
  color: [number, number, number];
  /** 0..1, applied as sprite intensity rather than material alpha. */
  opacity: number;
  /** Hide voxels with `|value| < threshold * max|v|`. */
  threshold: number;
  /** Sample every Nth voxel; larger is sparser. */
  stride: number;
  /** Also draw the ±a, ±b, ±c images when the box is fully periodic. */
  showPbcImages: boolean;
}

export const DEFAULT_VOLUME_CLOUD_STYLE: VolumeCloudStyle = {
  color: [0.4, 0.65, 1.0],
  opacity: 0.6,
  threshold: 0.08,
  stride: 1,
  showPbcImages: false,
};

export class VolumeCloudRenderer {
  private readonly scene: Scene;
  private readonly suffix: string;
  private mesh: Mesh | null = null;

  constructor(scene: Scene, namespace = "") {
    this.scene = scene;
    this.suffix = namespace ? `#${namespace}` : "";
  }

  get hasData(): boolean {
    return this.mesh !== null;
  }

  /** Replace the cloud with one built from `data`. */
  rebuild(
    data: Float64Array,
    shape: [number, number, number],
    cell: Float64Array,
    origin: Float64Array,
    style: VolumeCloudStyle,
    allPeriodic: boolean,
  ): void {
    this.dispose();
    this.mesh = this.build(data, shape, cell, origin, style, allPeriodic);
  }

  setVisible(visible: boolean): void {
    this.mesh?.setEnabled(visible);
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.material?.dispose();
      this.mesh.dispose();
    }
    this.mesh = null;
  }

  private build(
    data: Float64Array,
    shape: [number, number, number],
    cell: Float64Array,
    origin: Float64Array,
    style: VolumeCloudStyle,
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
        "[Volume cloud] channel is identically zero, nothing to draw",
      );
      return null;
    }

    const stride = Math.max(1, Math.floor(style.stride));
    const threshold = style.threshold * maxAbs;
    const negComplement: [number, number, number] = [
      1 - style.color[0],
      1 - style.color[1],
      1 - style.color[2],
    ];
    const baseAlpha = Math.max(0.05, Math.min(1, style.opacity));

    // PBC image offsets: the primary cell plus, optionally, every
    // adjacent image that the simbox declares periodic.
    const imageOffsets: Array<[number, number, number]> =
      style.showPbcImages && allPeriodic ? pbcImageOffsets() : [[0, 0, 0]];

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
        `[Volume cloud] threshold ${style.threshold} eliminated every voxel; lower the threshold to see points`,
      );
      return null;
    }

    const mesh = new Mesh(`${CLOUD_MESH_NAME}${this.suffix}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.colors = colors;
    vd.applyToMesh(mesh, true);

    // Spacing-aware point size: use the smallest voxel pitch so points
    // are distinguishable but not overlapping in the dense regions.
    const pitchA = Math.hypot(cell[0], cell[1], cell[2]) / nx;
    const pitchB = Math.hypot(cell[3], cell[4], cell[5]) / ny;
    const pitchC = Math.hypot(cell[6], cell[7], cell[8]) / nz;
    const pitch = Math.min(pitchA, pitchB, pitchC);
    const pointSize = Math.max(2, Math.min(8, pitch * 6));
    const mat = new ShaderMaterial(
      `${`${CLOUD_MESH_NAME}${this.suffix}`}_mat`,
      this.scene,
      { vertex: "molvisCloud", fragment: "molvisCloud" },
      {
        attributes: ["position", "color"],
        uniforms: ["worldViewProjection", "pointSize"],
        needAlphaBlending: true,
      },
    );
    mat.pointsCloud = true;
    mat.setFloat("pointSize", pointSize);
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
      `[Volume cloud] ${positions.length / 3} points across ${imageOffsets.length} cell image(s)`,
    );
    return mesh;
  }
}

/** Offsets for primary cell + 26 PBC neighbors (3×3×3 super-cell). */
function pbcImageOffsets(): Array<[number, number, number]> {
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
