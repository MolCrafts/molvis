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
  Material,
  Mesh,
  type Scene,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { readBackboneBlock } from "./backbone_block";
import { computeSideVectors } from "./orientation";
import type { ChainTrace, SecondaryStructureType } from "./pdb_backbone";
import {
  buildRibbonGeometry,
  RIBBON_CROSS_SECTION_SEGMENTS,
} from "./ribbon_geometry";
import {
  chainColor,
  DEFAULT_RIBBON_STYLE,
  type RibbonStyle,
  spectrumColor,
  ssColor,
} from "./ribbon_style";
import { catmullRomSpline } from "./spline";

/** Metadata attached to each ribbon chain mesh for picking / info. */
export interface RibbonMeshMeta {
  type: "ribbon";
  chainId: string;
  chainIndex: number;
  /** Residue name per residue along this chain. */
  resNames: string[];
  /** Residue sequence number per residue. */
  resSeqs: number[];
  /** Residue index for each spline sample point. */
  residueOfPoint: number[];
  /** Triangles between consecutive spline rings. */
  trisPerStep: number;
}

export function isRibbonMeshMeta(v: unknown): v is RibbonMeshMeta {
  return (
    !!v &&
    typeof v === "object" &&
    (v as RibbonMeshMeta).type === "ribbon" &&
    typeof (v as RibbonMeshMeta).chainId === "string"
  );
}

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
    this.applyOpacity(material, style.opacity);
    chains.forEach((chain, chainIdx) => {
      const mesh = this.buildChainMesh(chain, chainIdx, style, material);
      if (mesh) this.meshes.push(mesh);
    });
  }

  /**
   * Push the style's opacity into the shared ribbon material. When
   * fully opaque we explicitly switch back to MATERIAL_OPAQUE so the
   * mesh moves out of the alpha-blend pass — leaving it in alpha-blend
   * with alpha=1 still works visually but breaks early-Z and order
   * dependence inside the alpha bucket.
   */
  private applyOpacity(material: StandardMaterial, opacity: number): void {
    const a = Math.max(0, Math.min(1, opacity));
    material.alpha = a;
    if (a < 1) {
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
      material.needDepthPrePass = true;
      material.separateCullingPass = true;
    } else {
      material.transparencyMode = Material.MATERIAL_OPAQUE;
      material.needDepthPrePass = false;
      material.separateCullingPass = false;
    }
  }

  public setVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.setEnabled(visible);
  }

  /**
   * Live opacity update — used by the modifier panel's slider so the
   * user sees transparency change while dragging without rebuilding the
   * ribbon mesh. The modifier's stored `_opacity` is still authoritative
   * on the next full pipeline run; this just patches the shared
   * material in-place.
   */
  public setOpacity(opacity: number): void {
    const mat = this.scene.getMaterialByName(
      "__molvis_ribbon_mat__",
    ) as StandardMaterial | null;
    if (!mat) return;
    this.applyOpacity(mat, opacity);
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

    // Pack CA positions into a flat buffer; collect SS + colors in
    // residue order. The side-vector field is derived from CA-only
    // geometry (Carson-Bugg) — see `orientation.ts` for why the old
    // `O − CA` approach was scientifically wrong on β-strands.
    const caResidues = residues.filter((r) => r.ca);
    const m = caResidues.length;
    if (m < 2) return null;

    const positions = new Float64Array(m * 3);
    const ssTypes: SecondaryStructureType[] = [];
    const resNames: string[] = [];
    const resSeqs: number[] = [];
    const residueColors: [number, number, number][] = [];

    for (let i = 0; i < m; i++) {
      const r = caResidues[i];
      const ca = r.ca;
      if (!ca) continue;
      positions[i * 3 + 0] = ca.x;
      positions[i * 3 + 1] = ca.y;
      positions[i * 3 + 2] = ca.z;
      ssTypes.push(r.ss);
      resNames.push(r.resName);
      resSeqs.push(r.resSeq);
      residueColors.push(this.colorFor(r.ss, i, m, chainIdx, style));
    }

    const sides = computeSideVectors(positions);
    const splinePoints = catmullRomSpline(positions, sides, style.smoothness);
    if (splinePoints.length < 2) return null;

    // Resample SS + color from per-residue arrays into per-spline-point
    // arrays. Spline parameter `pt.t` is in [0, m-1]; floor gives the
    // upstream residue index.
    const residueOfPoint: number[] = splinePoints.map((pt) =>
      Math.min(Math.floor(pt.t), m - 1),
    );
    const ssPerPoint: SecondaryStructureType[] = residueOfPoint.map(
      (idx) => ssTypes[idx],
    );
    const colorPerPoint: [number, number, number][] = residueOfPoint.map(
      (idx) => residueColors[idx],
    );

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
    mesh.isPickable = true;
    // Long, often concave ribbon — bounding box can miss the frustum
    // at oblique angles even when the visible portion is on screen.
    // Skip frustum culling; raster cost is unaffected.
    mesh.alwaysSelectAsActiveMesh = true;

    const meta: RibbonMeshMeta = {
      type: "ribbon",
      chainId: chain.chainId,
      chainIndex: chainIdx,
      resNames,
      resSeqs,
      residueOfPoint,
      trisPerStep: RIBBON_CROSS_SECTION_SEGMENTS * 2,
    };
    mesh.metadata = meta;

    return mesh;
  }

  /**
   * Resolve the RGB triple for residue `i` of `n` in chain `chainIdx`
   * under `style`. All modes draw from the stage palette
   * (`ss` / `chain` → the categorical sequence, `spectrum` → viridis).
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
        return ssColor(ss, style);
      case "uniform":
        return [
          style.uniformColor[0],
          style.uniformColor[1],
          style.uniformColor[2],
        ];
      case "chain":
        return chainColor(chainIdx);
      case "spectrum": {
        // Full viridis ramp N→C (tame scientific continuum, not rainbow).
        const t = n <= 1 ? 0 : i / (n - 1);
        return spectrumColor(t);
      }
    }
  }

  private getOrCreateMaterial(): StandardMaterial {
    const name = "__molvis_ribbon_mat__";
    let mat = this.scene.getMaterialByName(name) as StandardMaterial | null;
    if (!mat) {
      mat = new StandardMaterial(name, this.scene);
      mat.backFaceCulling = false;
      mat.diffuseColor.set(1, 1, 1);
    }
    // Soft publication cartoon (aligns with RCSB / ChimeraX stills):
    // gentle specular, lifted ambient, no emissive glow.
    mat.specularColor.set(0.28, 0.28, 0.3);
    mat.specularPower = 48;
    mat.ambientColor.set(0.3, 0.3, 0.32);
    mat.emissiveColor.set(0, 0, 0);
    return mat;
  }
}
