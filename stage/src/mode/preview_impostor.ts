import {
  Color3,
  type Mesh,
  MeshBuilder,
  type ShaderMaterial,
  type Vector3,
} from "@babylonjs/core";
import type { MolvisApp } from "../app";
import { createImpostorMaterial } from "../artist/material_factory";
import {
  PreviewAtomBuffers,
  PreviewBondBuffers,
  type PreviewColor,
} from "./preview_impostor_buffers";

const TMP_LINEAR = new Color3();

/**
 * Edit-mode ghost drawn with the live impostor materials.
 *
 * The meshes are created on the first show (hot load) and then every pointer
 * move only rewrites their instance buffers. They are not registered on
 * `SceneIndex`, so a parallel agent update that rebuilds `ImpostorState`
 * leaves this preview in place, and this preview never writes that state.
 * Outline, shading, and lighting stay in sync because the mesh shares the
 * scene impostor material, whose bind callback uploads the current uniforms.
 */
export class PreviewManager {
  private atomMesh: Mesh | null = null;
  private bondMesh: Mesh | null = null;
  private readonly atomBuffers = new PreviewAtomBuffers();
  private readonly bondBuffers = new PreviewBondBuffers();

  constructor(private readonly app: MolvisApp) {}

  showAtom(position: Vector3, element: string, opacity = 0.5): void {
    const mesh = this.ensureAtom();
    const style = this.app.styleManager.getAtomStyle(element);
    this.atomBuffers.write(
      position,
      style.radius,
      colorOf(style.color, style.alpha),
      opacity,
    );
    this.flushAtom(mesh);
    this.reveal(mesh);
  }

  hideAtom(): void {
    this.conceal(this.atomMesh);
  }

  showBond(
    path: Vector3[],
    color1?: Color3,
    color2?: Color3,
    opacity = 0.5,
  ): void {
    const start = path[0];
    const end = path[1];
    if (!start || !end) {
      this.hideBond();
      return;
    }
    const radius = this.app.styleManager.getBondStyle(1).radius;
    // Opacity is stored on the color. The buffer multiplies by its own
    // opacity argument, so this pass is 1 and the ghost alpha is not squared.
    const wrote = this.bondBuffers.write(
      start,
      end,
      radius,
      fromColor3(color1, opacity),
      fromColor3(color2, opacity),
      1,
    );
    if (!wrote) {
      this.hideBond();
      return;
    }
    const mesh = this.ensureBond();
    this.flushBond(mesh);
    this.reveal(mesh);
  }

  hideBond(): void {
    this.conceal(this.bondMesh);
  }

  /** Drop the ghost. The next show hot-loads a fresh pair of meshes. */
  clear(): void {
    this.atomMesh?.dispose();
    this.bondMesh?.dispose();
    this.atomMesh = null;
    this.bondMesh = null;
  }

  private ensureAtom(): Mesh {
    if (this.atomMesh) return this.atomMesh;
    this.atomMesh = this.createMesh("preview_atom_impostor", "atom");
    return this.atomMesh;
  }

  private ensureBond(): Mesh {
    if (this.bondMesh) return this.bondMesh;
    this.bondMesh = this.createMesh("preview_bond_impostor", "bond");
    return this.bondMesh;
  }

  private createMesh(name: string, target: "atom" | "bond"): Mesh {
    const scene = this.app.scene;
    const materialName =
      target === "atom" ? "atomMat_impostor" : "bondMat_impostor";
    let material = scene.getMaterialByName(
      materialName,
    ) as ShaderMaterial | null;
    if (!material) {
      material = createImpostorMaterial(target, scene, this.app);
    }
    const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.alphaIndex = 1;
    mesh.freezeWorldMatrix();
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    mesh.setEnabled(false);
    return mesh;
  }

  private reveal(mesh: Mesh): void {
    mesh.thinInstanceCount = 1;
    mesh.isVisible = true;
    mesh.setEnabled(true);
  }

  private conceal(mesh: Mesh | null): void {
    if (!mesh) return;
    mesh.isVisible = false;
    mesh.setEnabled(false);
  }

  private flushAtom(mesh: Mesh): void {
    const buffers = this.atomBuffers;
    this.flush(mesh, "matrix", buffers.matrix, 16);
    this.flush(mesh, "instanceData", buffers.instanceData, 4);
    this.flush(mesh, "instanceColor", buffers.instanceColor, 4);
    this.flush(mesh, "instanceStyle", buffers.instanceStyle, 4);
    this.flush(mesh, "instancePickingColor", buffers.instancePickingColor, 4);
  }

  private flushBond(mesh: Mesh): void {
    const buffers = this.bondBuffers;
    this.flush(mesh, "matrix", buffers.matrix, 16);
    this.flush(mesh, "instanceData0", buffers.instanceData0, 4);
    this.flush(mesh, "instanceData1", buffers.instanceData1, 4);
    this.flush(mesh, "instanceColor0", buffers.instanceColor0, 4);
    this.flush(mesh, "instanceColor1", buffers.instanceColor1, 4);
    this.flush(mesh, "instanceSplit", buffers.instanceSplit, 4);
    this.flush(mesh, "instancePickingColor", buffers.instancePickingColor, 4);
  }

  /**
   * Re-upload the current numbers. `thinInstanceSetBuffer` is the path
   * `ImpostorState` uses; `thinInstanceBufferUpdated` drops updates.
   * `staticBuffer` stays false so the one-instance ghost can move.
   */
  private flush(
    mesh: Mesh,
    kind: string,
    data: Float32Array,
    stride: number,
  ): void {
    mesh.thinInstanceSetBuffer(kind, data, stride, false);
  }
}

function colorOf(hex: string, alpha: number | undefined): PreviewColor {
  Color3.FromHexString(hex).toLinearSpaceToRef(TMP_LINEAR);
  return { r: TMP_LINEAR.r, g: TMP_LINEAR.g, b: TMP_LINEAR.b, a: alpha ?? 1 };
}

function fromColor3(color: Color3 | undefined, opacity: number): PreviewColor {
  (color ?? Color3.Gray()).toLinearSpaceToRef(TMP_LINEAR);
  return { r: TMP_LINEAR.r, g: TMP_LINEAR.g, b: TMP_LINEAR.b, a: opacity };
}
