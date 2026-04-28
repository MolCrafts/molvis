/**
 * RibbonRenderer — stateless (w.r.t. events) protein-backbone mesh holder.
 *
 * Driven by `DrawRibbonModifier.apply()` via `Artist.drawRibbon()`. A
 * frame without a `residues` block (populated by
 * `DrawRibbonModifier`'s own pre-render pass) produces no meshes —
 * this class never traverses atoms or computes secondary structure;
 * it only consumes the residues block and emits geometry.
 *
 * Per redraw it accepts a {@link RibbonStyle} (color mode, width
 * scale, smoothness) so the modifier's UI sliders / dropdowns
 * propagate without changing rendering invariants.
 */

import {
  Mesh,
  type Scene,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { Frame } from "@molcrafts/molrs";
import { readBackboneBlock } from "./backbone_block";
import type { ChainTrace, SecondaryStructureType } from "./pdb_backbone";
import { buildRibbonGeometry } from "./ribbon_geometry";
import {
  DEFAULT_RIBBON_STYLE,
  type RibbonStyle,
  chainColor,
  hueToRgb,
} from "./ribbon_style";
import { catmullRomSpline } from "./spline";

const SS_COLORS: Record<SecondaryStructureType, [number, number, number]> = {
  helix: [0.9, 0.2, 0.3],
  sheet: [0.95, 0.85, 0.1],
  coil: [0.6, 0.6, 0.6],
};

export class RibbonRenderer {
  private meshes: Mesh[] = [];
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Rebuild ribbon meshes from `frame` using the given style. Safe to
   * call repeatedly; stale meshes are torn down first.
   */
  public syncFromFrame(
    frame: Frame,
    style: RibbonStyle = DEFAULT_RIBBON_STYLE,
  ): void {
    const chains = readBackboneBlock(frame);
    this.dispose();
    if (chains.length === 0) return;

    const material = this.getOrCreateMaterial();
    chains.forEach((chain, chainIdx) => {
      const mesh = this.buildChainMesh(chain, chainIdx, style, material);
      if (mesh) this.meshes.push(mesh);
    });
  }

  public setVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.setEnabled(visible);
  }

  public get hasData(): boolean {
    return this.meshes.length > 0;
  }

  public dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
  }

  private buildChainMesh(
    chain: ChainTrace,
    chainIdx: number,
    style: RibbonStyle,
    material: StandardMaterial,
  ): Mesh | null {
    const residues = chain.residues;
    const n = residues.length;
    if (n < 2) return null;

    const positions = new Float64Array(n * 3);
    const normals = new Float64Array(n * 3);
    const ssTypes: SecondaryStructureType[] = [];
    const residueColors: [number, number, number][] = [];

    for (let i = 0; i < n; i++) {
      const r = residues[i];
      const ca = r.ca;
      if (!ca) continue;

      positions[i * 3 + 0] = ca.x;
      positions[i * 3 + 1] = ca.y;
      positions[i * 3 + 2] = ca.z;

      // Carbonyl direction reference for ribbon orientation. Falls
      // back to +Y when the residue lacks an O (chain ends, edge
      // residues from upstream PBC splits).
      if (r.o) {
        let nx = r.o.x - ca.x;
        let ny = r.o.y - ca.y;
        let nz = r.o.z - ca.z;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-8) {
          nx /= len;
          ny /= len;
          nz /= len;
        }
        normals[i * 3 + 0] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
      } else {
        normals[i * 3 + 0] = 0;
        normals[i * 3 + 1] = 1;
        normals[i * 3 + 2] = 0;
      }

      ssTypes.push(r.ss);
      residueColors.push(this.colorFor(r.ss, i, n, chainIdx, style));
    }

    const splinePoints = catmullRomSpline(positions, normals, style.smoothness);
    if (splinePoints.length < 2) return null;

    // Resample SS + color from per-residue arrays into per-spline-point
    // arrays. Spline parameter `pt.t` is in [0, n-1]; floor gives the
    // upstream residue index — close enough for a discrete attribute
    // like SS, and fine for color since we want sharp residue
    // boundaries (no per-spline-point interpolation).
    const ssPerPoint: SecondaryStructureType[] = splinePoints.map((pt) => {
      const idx = Math.min(Math.floor(pt.t), n - 1);
      return ssTypes[idx];
    });
    const colorPerPoint: [number, number, number][] = splinePoints.map((pt) => {
      const idx = Math.min(Math.floor(pt.t), n - 1);
      return residueColors[idx];
    });

    const geo = buildRibbonGeometry(
      splinePoints,
      ssPerPoint,
      colorPerPoint,
      style.widthScale,
    );

    const mesh = new Mesh(`ribbon_${chain.chainId}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = geo.positions;
    vertexData.normals = geo.normals;
    vertexData.indices = geo.indices;
    vertexData.applyToMesh(mesh);

    mesh.setVerticesBuffer(
      new VertexBuffer(
        this.scene.getEngine(),
        geo.colors,
        VertexBuffer.ColorKind,
        false,
        false,
        4,
      ),
    );

    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  /**
   * Resolve the RGB triple for residue `i` of `n` in chain `chainIdx`
   * under `style`. SS colors stay the same as before; the new modes
   * delegate to {@link hueToRgb} / {@link chainColor}.
   */
  private colorFor(
    ss: SecondaryStructureType,
    i: number,
    n: number,
    chainIdx: number,
    style: RibbonStyle,
  ): [number, number, number] {
    switch (style.colorMode) {
      case "ss":
        return SS_COLORS[ss];
      case "uniform":
        return [
          style.uniformColor[0],
          style.uniformColor[1],
          style.uniformColor[2],
        ];
      case "chain":
        return chainColor(chainIdx);
      case "spectrum": {
        // Hue cycles 0 (red) → 0.78 (purple) along the chain, leaving
        // a small gap so the start and end aren't visually identical.
        const t = n <= 1 ? 0 : i / (n - 1);
        return hueToRgb(t * 0.78);
      }
    }
  }

  private getOrCreateMaterial(): StandardMaterial {
    const name = "__molvis_ribbon_mat__";
    const existing = this.scene.getMaterialByName(
      name,
    ) as StandardMaterial | null;
    if (existing) return existing;

    // Subtler highlights than the old ribbon material (specular 0.3)
    // — protein cartoon figures look "plastic" if the spec is too
    // bright. Slight ambient lifts the shadow side without flattening.
    const mat = new StandardMaterial(name, this.scene);
    mat.backFaceCulling = false;
    mat.diffuseColor.set(1, 1, 1);
    mat.specularColor.set(0.12, 0.12, 0.12);
    mat.specularPower = 48;
    mat.ambientColor.set(0.25, 0.25, 0.25);
    return mat;
  }
}
