import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  type ShaderMaterial,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import type { Block, Box, Frame } from "@molcrafts/molrs";
import { WasmArray } from "@molcrafts/molrs";
import type { MolvisApp } from "./app";

import {
  type AtomBufferOptions,
  buildAtomBuffers,
  buildAtomColorOnly,
} from "./artist/atom_buffer";
import {
  buildBondBuffers,
  buildSubBondInstanceBuffers,
  clampBondOrder,
  refreshBondPositions,
} from "./artist/bond_buffer";
import {
  DEFAULT_ISOSURFACE_STYLE,
  IsosurfaceRenderer,
  type IsosurfaceStyle,
} from "./artist/isosurface/isosurface_renderer";
import { LabelRenderer } from "./artist/label_renderer";
import {
  compileShaderMaterial,
  createImpostorMaterial,
  syncImpostorMaterialUniforms,
} from "./artist/material_factory";
import {
  type ImpostorTarget,
  getImpostorMaterialSpec,
} from "./artist/material_spec";
import { RibbonRenderer } from "./artist/ribbon/ribbon_renderer";
import { findSliceModifier, updateVisualGuide } from "./artist/visual_guide";
import { createWarmupMesh } from "./artist/warmup";
import type { AtomMeta, BondMeta } from "./entity_source";
import type { ImpostorState } from "./scene_index";
import { registerImpostorShaders } from "./shaders/impostor";
import { DType } from "./utils/dtype";

/**
 * Artist options for initialization
 */
export interface ArtistOptions {
  app: MolvisApp;
}

/**
 * Options for drawing a single atom
 */
export interface DrawAtomOptions {
  element: string;
  name?: string;
  radius?: number;
  color?: string;
  atomId?: number;
}

/**
 * Options for drawing a single bond
 */
export interface DrawBondOptions {
  order?: number;
  radius?: number;
  atomId1?: number;
  atomId2?: number;
  bondId?: number;
}

/**
 * Module-level scratch buffers for `computeBondMIDisplacements` so the
 * hot per-frame path doesn't allocate. Grow on demand; the returned
 * subarray view is valid only until the next call.
 */
let MI_A_SCRATCH = new Float64Array(0);
let MI_B_SCRATCH = new Float64Array(0);
let MI_OUT_SCRATCH = new Float64Array(0);

/**
 * Compute per-bond minimum-image displacement vectors
 * `(atom_j - atom_i)` via WASM `Box.delta(..., minimum_image = true)`.
 *
 * Returns a row-major `Float64Array` view of length `3 * nbonds`
 * (`[dx0, dy0, dz0, dx1, …]`) to feed into `buildBondBuffers` /
 * `refreshBondPositions` via their `miDisplacements` option. Returns
 * `undefined` when there's no box, no bonds, or the required
 * columns/views are missing.
 *
 * Why in WASM: `Box.delta` knows per-axis PBC flags and the full `h`
 * cell matrix, so triclinic cells and partial-PBC setups (e.g. 2D
 * slabs with z non-periodic) get correct minimum-image handling for
 * free — no JS-side axis-length approximation.
 *
 * The returned array is a view over module-level scratch storage and
 * is overwritten on the next call. Callers consume it synchronously
 * inside one render/refresh and must not retain it across frames.
 */
function computeBondMIDisplacements(
  frame: Frame,
  atomsBlock: Block,
  bondsBlock: Block,
): Float64Array | undefined {
  const box = frame.simbox;
  if (!box) return undefined;
  const nbonds = bondsBlock.nrows();
  if (nbonds === 0) return undefined;

  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");
  if (!iAtoms || !jAtoms) return undefined;

  const x = atomsBlock.viewColF("x");
  const y = atomsBlock.viewColF("y");
  const z = atomsBlock.viewColF("z");
  if (!x || !y || !z) return undefined;

  const flatLen = nbonds * 3;
  if (MI_A_SCRATCH.length < flatLen) {
    MI_A_SCRATCH = new Float64Array(flatLen);
    MI_B_SCRATCH = new Float64Array(flatLen);
    MI_OUT_SCRATCH = new Float64Array(flatLen);
  }
  const aBuf = MI_A_SCRATCH;
  const bBuf = MI_B_SCRATCH;
  for (let b = 0; b < nbonds; b++) {
    const i = iAtoms[b];
    const j = jAtoms[b];
    const o = 3 * b;
    aBuf[o] = x[i];
    aBuf[o + 1] = y[i];
    aBuf[o + 2] = z[i];
    bBuf[o] = x[j];
    bBuf[o + 1] = y[j];
    bBuf[o + 2] = z[j];
  }

  const shape = new Uint32Array([nbonds, 3]);
  const aArr = WasmArray.from(aBuf.subarray(0, flatLen), shape);
  const bArr = WasmArray.from(bBuf.subarray(0, flatLen), shape);
  try {
    const delta = box.delta(aArr, bArr, true);
    try {
      MI_OUT_SCRATCH.set(delta.toTypedArray());
      return MI_OUT_SCRATCH.subarray(0, flatLen);
    } finally {
      delta.free();
    }
  } finally {
    aArr.free();
    bArr.free();
  }
}

function copyAndFree(wa: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return wa.toCopy();
  } finally {
    wa.free();
  }
}

const IDENTITY_CELL: number[][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Reconstruct the 3x3 cell matrix from a `Box` by reading its 8
 * parallelepiped corners. Robust to triclinic geometry — corners 1/2/4
 * (relative to corner 0 which is the origin) are exactly the a/b/c
 * lattice vectors, regardless of tilt convention.
 */
function readCellFromBox(box: Box): number[][] {
  const corners = copyAndFree(box.get_corners());
  const o0 = [corners[0], corners[1], corners[2]];
  const a = [corners[3] - o0[0], corners[4] - o0[1], corners[5] - o0[2]];
  const b = [corners[6] - o0[0], corners[7] - o0[1], corners[8] - o0[2]];
  const c = [corners[12] - o0[0], corners[13] - o0[1], corners[14] - o0[2]];
  return [a, b, c];
}

/**
 * Pick the most relevant column to render from a `"grid"` block.
 * Prefers `electron_density` for chemistry-friendly defaults; falls
 * back to whichever column happens to be first.
 */
function pickGridColumn(block: Block): string | null {
  const keys = block.keys();
  if (!keys || keys.length === 0) return null;
  if (keys.includes("electron_density")) return "electron_density";
  return keys[0] ?? null;
}

/**
 * Artist — Unified Graphics Engine
 *
 * Orchestrates rendering by delegating to focused modules:
 * - material_factory: shader material creation + compilation
 * - atom_buffer / bond_buffer: GPU buffer computation (pure math)
 * - visual_guide: slice modifier wireframe
 * - warmup: shader pre-compilation
 */
export class Artist {
  private app: MolvisApp;
  private _globalOpacity = 1.0;
  private shaderCompileTasks = new Map<ImpostorTarget, Promise<void>>();

  public atomMesh: Mesh;
  public bondMesh: Mesh;
  public cloudMesh: Mesh | null = null;
  public ribbonRenderer: RibbonRenderer;
  public isosurfaceRenderer: IsosurfaceRenderer;
  public labelRenderer: LabelRenderer;

  get globalOpacity(): number {
    return this._globalOpacity;
  }

  /**
   * Set global opacity for all atoms and bonds.
   * Modifies instanceColor alpha on existing buffers in-place.
   */
  setGlobalOpacity(opacity: number): void {
    this._globalOpacity = Math.max(0.02, Math.min(1.0, opacity));
    this.applyGlobalOpacity();
  }

  /**
   * Set opacity for specific atom indices.
   * Modifies instanceColor alpha in-place for the given atoms.
   */
  setAtomOpacity(indices: Iterable<number>, opacity: number): void {
    const clamped = Math.max(0.02, Math.min(1.0, opacity));
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) return;

    const colorDesc = atomState.buffers.get("instanceColor");
    if (!colorDesc) return;

    const total = atomState.frameOffset + atomState.count;
    for (const idx of indices) {
      if (idx >= 0 && idx < total) {
        colorDesc.data[idx * 4 + 3] = clamped;
      }
    }
    atomState.uploadBuffer("instanceColor");
  }

  /**
   * Set opacity on bonds whose either endpoint is in the given atom set.
   * Iterates all logical bonds and applies opacity to all render instances.
   */
  setBondOpacityForAtoms(
    atomIndices: ReadonlySet<number>,
    opacity: number,
  ): void {
    const clamped = Math.max(0.02, Math.min(1.0, opacity));
    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState) return;

    const c0 = bondState.buffers.get("instanceColor0");
    const c1 = bondState.buffers.get("instanceColor1");
    if (!c0 || !c1) return;

    const bondsBlock = this.app.world.sceneIndex.metaRegistry.bonds.frameBlock;
    if (!bondsBlock) return;

    const iAtoms = bondsBlock.viewColU32("atomi");
    const jAtoms = bondsBlock.viewColU32("atomj");
    if (!iAtoms || !jAtoms) return;
    const orderCol =
      bondsBlock.dtype("order") === DType.U32
        ? bondsBlock.viewColU32("order")
        : undefined;
    if (!iAtoms || !jAtoms) return;

    const logicalCount = bondsBlock.nrows();
    let renderIdx = 0;
    for (let b = 0; b < logicalCount; b++) {
      const order = orderCol ? orderCol[b] : 1;
      const hit = atomIndices.has(iAtoms[b]) || atomIndices.has(jAtoms[b]);
      for (let s = 0; s < order && renderIdx < bondState.frameOffset; s++) {
        if (hit) {
          c0.data[renderIdx * 4 + 3] = clamped;
          c1.data[renderIdx * 4 + 3] = clamped;
        }
        renderIdx++;
      }
    }
    bondState.uploadBuffer("instanceColor0");
    bondState.uploadBuffer("instanceColor1");
  }

  private applyGlobalOpacity(): void {
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (atomState) {
      const colorDesc = atomState.buffers.get("instanceColor");
      if (colorDesc) {
        const total = atomState.frameOffset + atomState.count;
        for (let i = 0; i < total; i++) {
          colorDesc.data[i * 4 + 3] = this._globalOpacity;
        }
        atomState.uploadBuffer("instanceColor");
      }
    }

    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (bondState) {
      const c0 = bondState.buffers.get("instanceColor0");
      const c1 = bondState.buffers.get("instanceColor1");
      if (c0 && c1) {
        const total = bondState.frameOffset + bondState.count;
        for (let i = 0; i < total; i++) {
          c0.data[i * 4 + 3] = this._globalOpacity;
          c1.data[i * 4 + 3] = this._globalOpacity;
        }
        bondState.uploadBuffer("instanceColor0");
        bondState.uploadBuffer("instanceColor1");
      }
    }
  }

  constructor(options: ArtistOptions) {
    registerImpostorShaders();
    this.app = options.app;
    const scene = this.app.world.scene;

    this.atomMesh = this.createBaseMesh(
      "atom_base_renderer",
      "atomMat_impostor",
      scene,
    );
    this.bondMesh = this.createBaseMesh(
      "bond_base_renderer",
      "bondMat_impostor",
      scene,
    );
    this.ribbonRenderer = new RibbonRenderer(scene);
    this.isosurfaceRenderer = new IsosurfaceRenderer(scene);
    this.labelRenderer = new LabelRenderer(scene);
    this.registerRuntimeLayers();
  }

  // ============ Shader Preparation ============

  private async ensureShadersForVisibleGeometry(
    targets: ImpostorTarget[],
  ): Promise<void> {
    if (targets.length === 0) return;

    this.app.world.renderOnce();
    await Promise.all(
      targets.map((target) => this.ensureTargetShaderReady(target)),
    );
  }

  private ensureTargetShaderReady(target: ImpostorTarget): Promise<void> {
    const existing = this.shaderCompileTasks.get(target);
    if (existing) return existing;

    const scene = this.app.world.scene;
    const spec = getImpostorMaterialSpec(target);
    const mesh = target === "atom" ? this.atomMesh : this.bondMesh;
    const material = mesh.material as ShaderMaterial | null;

    if (material) {
      syncImpostorMaterialUniforms(material, scene, this.app);
    }

    const warmupMesh = material
      ? createWarmupMesh(`__molvis_warmup_${target}__`, scene, material, spec)
      : null;

    const compileTask = compileShaderMaterial(
      warmupMesh ?? mesh,
      material,
      spec,
    ).finally(() => {
      warmupMesh?.dispose();
    });

    this.shaderCompileTasks.set(target, compileTask);
    return compileTask.catch((error) => {
      this.shaderCompileTasks.delete(target);
      throw error;
    });
  }

  // ============ Scene Lifecycle ============

  public clear(): void {
    const scene = this.app.world.scene;

    this.atomMesh.dispose();
    this.bondMesh.dispose();
    this.cloudMesh?.dispose();
    this.cloudMesh = null;

    // Dispose box mesh if present
    const boxMesh = scene.getMeshByName("sim_box");
    if (boxMesh) {
      boxMesh.dispose();
    }

    // Frame-derived auxiliary meshes — ribbon backbone strips and atom
    // text labels are owned by their own renderers but still belong to
    // "current scene content", so they must go when atoms/bonds do.
    // Without these calls, Reset Scene leaves ghost ribbons/labels
    // floating over an otherwise empty viewport.
    this.ribbonRenderer.dispose();
    this.isosurfaceRenderer.dispose();
    this.labelRenderer.clearLabels();

    this.app.world.sceneIndex.clear();

    this.atomMesh = this.createBaseMesh(
      "atom_base_renderer",
      "atomMat_impostor",
      scene,
    );
    this.bondMesh = this.createBaseMesh(
      "bond_base_renderer",
      "bondMat_impostor",
      scene,
    );
    this.registerRuntimeLayers();
  }

  public dispose(): void {
    this.atomMesh.dispose();
    this.bondMesh.dispose();
    this.cloudMesh?.dispose();
    this.ribbonRenderer.dispose();
    this.isosurfaceRenderer.dispose();
    this.labelRenderer.dispose();
  }

  // ============ Frame Rendering (Bulk) ============

  /**
   * Composer: full-frame draw. Used by external callers (e.g. python
   * RPC's `scene.draw_frame` and editor mode entry) that want a
   * one-shot "render this frame" entry point. The pipeline path no
   * longer goes through here — `DrawAtomModifier` / `DrawBondModifier`
   * call `drawAtoms()` / `drawBonds()` directly so each visual element
   * lives as its own modifier.
   */
  public async drawFrame(
    frame: Frame,
    _box?: Box,
    options?: {
      atoms?: AtomBufferOptions & { impostor?: boolean };
      bonds?: { radii?: number; impostor?: boolean };
    },
  ): Promise<void> {
    this.clear();
    await this.drawAtoms(frame, options?.atoms);
    await this.drawBonds(frame, {
      ...options?.bonds,
      visible: options?.atoms?.visible,
    });
    this.applySceneIndexToMeshes();
    this.renderAuxiliaryLayers(frame);
    this.applySliceMaskIfPresent(frame);
    this.app.world.sceneIndex.markAllSaved();
    this.app.events.emit("frame-rendered", { frame, box: _box });
    updateVisualGuide(
      this.app.world.scene,
      findSliceModifier(this.app.modifierPipeline),
    );
  }

  /**
   * Per-modifier atom draw path. Builds atom buffers, registers the
   * atom layer in `SceneIndex`, and uploads to the GPU. Does not
   * touch bonds, auxiliary layers, or slice. Idempotent: calling
   * twice with the same frame is fine; the atom layer is overwritten.
   *
   * Always resets topology because atoms are the structural anchor —
   * every bond references atom indices, so re-registering atoms means
   * the previous topology is stale.
   */
  public async drawAtoms(
    frame: Frame,
    options?: AtomBufferOptions & { impostor?: boolean },
  ): Promise<void> {
    const atomsBlock = frame.getBlock("atoms");
    if (!atomsBlock || atomsBlock.nrows() === 0) return;

    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: atomsBlock.nrows(),
        bondCount: 0,
      }),
    );

    const atomBuffers = buildAtomBuffers(
      atomsBlock,
      this.app.styleManager,
      this.atomMesh.uniqueId,
      options,
    );

    this.app.world.sceneIndex.registerAtomFrame({
      frame,
      mesh: this.atomMesh,
      block: atomsBlock,
      buffers: atomBuffers,
    });
  }

  /**
   * Per-modifier bond draw path. Builds bond buffers using the atom
   * color buffer (recomputes locally if atoms haven't been registered
   * yet — e.g. if `DrawAtomModifier` is disabled) and registers the
   * bond layer in `SceneIndex`. Adds bond entries to topology without
   * clearing it.
   */
  public async drawBonds(
    frame: Frame,
    options?: { radii?: number; impostor?: boolean; visible?: boolean[] },
  ): Promise<void> {
    const atomsBlock = frame.getBlock("atoms");
    const bondsBlock = frame.getBlock("bonds");
    if (!atomsBlock || !bondsBlock || bondsBlock.nrows() === 0) return;

    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: atomsBlock.nrows(),
        bondCount: bondsBlock.nrows(),
      }),
    );

    const sceneIndex = this.app.world.sceneIndex;
    const atomColor = this.resolveAtomColorForBonds(atomsBlock);

    const visible = options?.visible;
    const bondResult = buildBondBuffers(
      bondsBlock,
      atomsBlock,
      atomColor,
      this.bondMesh.uniqueId,
      {
        radius: options?.radii ?? this.app.styleManager.getBondStyle(1).radius,
        visible: visible ? (i: number) => visible[i] : undefined,
        miDisplacements: computeBondMIDisplacements(
          frame,
          atomsBlock,
          bondsBlock,
        ),
      },
    );
    if (!bondResult) return;

    sceneIndex.registerBondFrame({
      frame,
      mesh: this.bondMesh,
      block: bondsBlock,
      buffers: bondResult.buffers,
      instanceCount: bondResult.instanceCount,
      instanceMap: bondResult.instanceMap,
    });
  }

  /**
   * Bond bicolor coloring needs per-atom RGBA. Reuse the already-
   * registered atom buffer when `DrawAtomModifier` ran first;
   * otherwise compute a fresh color-only buffer (the bond layer
   * still works when atoms are disabled). Encapsulates the
   * impostor-state probe so modifiers don't reach into buffers.
   */
  private resolveAtomColorForBonds(atomsBlock: Block): Float32Array {
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    const registered = atomState?.buffers.get("instanceColor")?.data as
      | Float32Array
      | undefined;
    if (registered) return registered;
    return buildAtomColorOnly(atomsBlock, this.app.styleManager);
  }

  /**
   * Shared "apply slice mask if a SliceModifier is in the pipeline".
   * Used by both the composer paths (`drawFrame` / `redrawFrame`) and
   * by `applyPipeline()` after the pipeline has run.
   */
  public applySliceMaskIfPresent(frame: Frame): void {
    const sliceMod = findSliceModifier(this.app.modifierPipeline);
    if (sliceMod?.visibilityMask) {
      this.applySliceVisibility(sliceMod.visibilityMask, frame);
    }
  }

  /**
   * Draw the simulation-box wireframe for a frame's molrs Box.
   *
   * Disposes any existing `sim_box` mesh, builds 12 cylinder edges
   * connecting the box corners, and registers the parent mesh in the
   * scene index. Attaches an `onBeforeRenderObservable` that adjusts
   * cylinder thickness based on camera distance, so edges read at any
   * zoom level. The observer is removed when the box mesh disposes.
   */
  public drawBox(
    box: Box | undefined,
    options?: { thicknessScale?: number },
  ): void {
    const scene = this.app.world.scene;
    const thicknessScale = options?.thicknessScale ?? 1.0;

    const existing = scene.getMeshByName("sim_box");
    if (existing) {
      // Scoped unregister — `sceneIndex.unregister(meshId)` would clear
      // atom/bond state too, which wipes a co-attached DrawAtom's just-
      // registered atom layer when multiple DrawBoxes run in the same
      // pipeline pass (multi-DS auto-attach scenario).
      this.app.world.sceneIndex.unregisterBox();
      existing.dispose();
    }

    if (!box) return;

    const corners = copyAndFree(box.get_corners()); // length 24

    const root = new Mesh("sim_box", scene);
    root.isPickable = false;

    const material = this.app.styleManager.getBoxMaterial();

    const edges: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [0, 3],
      [0, 4],
      [1, 5],
      [4, 5],
      [6, 5],
      [2, 6],
      [2, 3],
      [1, 2],
      [4, 7],
      [3, 7],
      [6, 7],
    ];

    const getPoint = (idx: number): Vector3 =>
      new Vector3(corners[idx * 3], corners[idx * 3 + 1], corners[idx * 3 + 2]);

    const l = copyAndFree(box.lengths());
    const o = copyAndFree(box.origin());
    const center = new Vector3(o[0], o[1], o[2]).add(
      new Vector3(l[0], l[1], l[2]).scale(0.5),
    );

    for (const [i, j] of edges) {
      const p1 = getPoint(i);
      const p2 = getPoint(j);
      const diff = p2.subtract(p1);
      const len = diff.length();

      const cyl = MeshBuilder.CreateCylinder(
        "box_edge",
        { height: len, diameter: 1, tessellation: 8 },
        scene,
      );
      cyl.material = material;
      cyl.parent = root;
      cyl.isPickable = false;
      cyl.position = p1.add(diff.scale(0.5));

      const up = new Vector3(0, 1, 0);
      const dir = diff.normalizeToNew();
      const dot = Vector3.Dot(up, dir);
      if (dot < -0.9999) {
        cyl.rotationQuaternion = Quaternion.FromEulerAngles(Math.PI, 0, 0);
      } else if (dot > 0.9999) {
        cyl.rotationQuaternion = Quaternion.Identity();
      } else {
        const axis = Vector3.Cross(up, dir);
        const angle = Math.acos(dot);
        cyl.rotationQuaternion = Quaternion.RotationAxis(
          axis.normalize(),
          angle,
        );
      }
    }

    const updateThickness = () => {
      if (root.isDisposed() || !scene.activeCamera) return;
      const dist = Vector3.Distance(scene.activeCamera.position, center);
      const scale = Math.max(dist * 0.002 * thicknessScale, 0.015);
      const children = root.getChildren() as Mesh[];
      for (const child of children) {
        if (Math.abs(child.scaling.x - scale) > 0.0001) {
          child.scaling.x = scale;
          child.scaling.z = scale;
        }
      }
    };
    const observer = scene.onBeforeRenderObservable.add(updateThickness);
    root.onDisposeObservable.add(() => {
      scene.onBeforeRenderObservable.remove(observer);
    });

    this.app.world.sceneIndex.registerBox({
      mesh: root,
      meta: {
        dimensions: [l[0], l[1], l[2]],
        origin: [o[0], o[1], o[2]],
      },
    });
  }

  /** Remove the simulation-box wireframe (disposes mesh + observer). */
  public clearBox(): void {
    const scene = this.app.world.scene;
    const existing = scene.getMeshByName("sim_box");
    if (existing) {
      this.app.world.sceneIndex.unregisterBox();
      existing.dispose();
    }
  }

  public drawCloud(
    block: Block,
    columnName: string,
    simbox: Box | undefined,
    options?: {
      stride?: number;
      threshold?: number;
      pointSize?: number;
      alpha?: number;
    },
  ): void {
    this.cloudMesh?.dispose();
    this.cloudMesh = null;

    const valuesArray = block.copyColF(columnName);
    if (!valuesArray || valuesArray.length === 0) return;

    const shape = Array.from(block.shape());
    if (shape.length !== 3) return;

    let maxAbs = 0;
    for (let i = 0; i < valuesArray.length; i++) {
      const value = Math.abs(valuesArray[i]);
      if (value > maxAbs) maxAbs = value;
    }
    if (maxAbs <= 0) return;

    const stride =
      options?.stride ?? Math.max(1, Math.floor(Math.max(...shape) / 48));
    const threshold = options?.threshold ?? maxAbs * 0.08;
    const alpha = options?.alpha ?? 0.18;

    // Geometry comes from the simulation box. CHGCAR / POSCAR / CUBE
    // all share their voxel lattice with the simulation cell, so origin
    // and cell vectors derive from `frame.simbox` rather than per-grid
    // metadata. Without a simbox we fall back to a unit cell at the
    // origin; that lets the renderer at least show structure but won't
    // be physically meaningful.
    const origin: number[] = simbox
      ? Array.from(copyAndFree(simbox.origin()))
      : [0, 0, 0];
    const cell = simbox ? readCellFromBox(simbox) : IDENTITY_CELL;
    const spacing = [
      Math.hypot(
        cell[0][0] / shape[0],
        cell[0][1] / shape[0],
        cell[0][2] / shape[0],
      ),
      Math.hypot(
        cell[1][0] / shape[1],
        cell[1][1] / shape[1],
        cell[1][2] / shape[1],
      ),
      Math.hypot(
        cell[2][0] / shape[2],
        cell[2][1] / shape[2],
        cell[2][2] / shape[2],
      ),
    ];
    const pointSize =
      options?.pointSize ?? Math.max(2, Math.min(...spacing) * 18);

    const positions: number[] = [];
    const colors: number[] = [];

    const index = (ix: number, iy: number, iz: number) =>
      (ix * shape[1] + iy) * shape[2] + iz;

    for (let ix = 0; ix < shape[0]; ix += stride) {
      for (let iy = 0; iy < shape[1]; iy += stride) {
        for (let iz = 0; iz < shape[2]; iz += stride) {
          const value = valuesArray[index(ix, iy, iz)];
          const magnitude = Math.abs(value);
          if (magnitude < threshold) continue;

          const fx = ix / shape[0];
          const fy = iy / shape[1];
          const fz = iz / shape[2];
          const px =
            origin[0] + fx * cell[0][0] + fy * cell[1][0] + fz * cell[2][0];
          const py =
            origin[1] + fx * cell[0][1] + fy * cell[1][1] + fz * cell[2][1];
          const pz =
            origin[2] + fx * cell[0][2] + fy * cell[1][2] + fz * cell[2][2];
          const t = Math.min(1, magnitude / maxAbs);

          positions.push(px, py, pz);

          colors.push(
            0.08 + 0.92 * t,
            0.28 + 0.62 * t,
            0.95 - 0.35 * t,
            alpha * (0.35 + 0.65 * t),
          );
        }
      }
    }

    if (colors.length === 0) return;

    const scene = this.app.world.scene;
    const cloudMesh = new Mesh("field_cloud_renderer", scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.colors = colors;
    vertexData.applyToMesh(cloudMesh, true);

    const material = new StandardMaterial("field_cloud_material", scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.pointsCloud = true;
    material.pointSize = pointSize;
    material.alphaMode = 2;
    cloudMesh.material = material;
    cloudMesh.isPickable = false;
    cloudMesh.alwaysSelectAsActiveMesh = true;
    this.cloudMesh = cloudMesh;
  }

  // ============ Frame Refresh (Fast Path) ============

  /**
   * Composer for the position-only fast path. External callers and
   * the legacy editor mode use this to refresh a frame without doing
   * a full mesh rebuild. The pipeline path calls
   * `refreshAtomPositions()` + `refreshBondPositions()` directly from
   * `DrawAtomModifier` / `DrawBondModifier`.
   */
  public redrawFrame(frame: Frame): void {
    this.refreshAtomPositions(frame);
    this.refreshBondPositions(frame);
    this.renderAuxiliaryLayers(frame);
    const sliceMod = findSliceModifier(this.app.modifierPipeline);
    updateVisualGuide(this.app.world.scene, sliceMod);
    if (sliceMod?.visibilityMask) {
      this.applySliceVisibility(sliceMod.visibilityMask, frame);
    }
  }

  /**
   * Update atom positions in place — no buffer realloc, no topology
   * rebuild, no mesh dispose. Used by `DrawAtomModifier` on the
   * position-only fast path during trajectory playback.
   */
  public refreshAtomPositions(frame: Frame): void {
    const atomsBlock = frame.getBlock("atoms");
    if (!atomsBlock || atomsBlock.nrows() === 0) return;

    const x = atomsBlock.viewColF("x");
    const y = atomsBlock.viewColF("y");
    const z = atomsBlock.viewColF("z");
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!x || !y || !z || !atomState) return;

    const count = Math.min(atomsBlock.nrows(), atomState.getTotalCount());
    const matDesc = atomState.buffers.get("matrix");
    const dataDesc = atomState.buffers.get("instanceData");
    if (!matDesc || !dataDesc) return;

    for (let i = 0; i < count; i++) {
      matDesc.data[i * 16 + 12] = x[i];
      matDesc.data[i * 16 + 13] = y[i];
      matDesc.data[i * 16 + 14] = z[i];

      dataDesc.data[i * 4 + 0] = x[i];
      dataDesc.data[i * 4 + 1] = y[i];
      dataDesc.data[i * 4 + 2] = z[i];
    }
    atomState.uploadBuffer("matrix");
    atomState.uploadBuffer("instanceData");
  }

  /**
   * Update bond positions in place. Recomputes bond endpoints from
   * the atom coordinates in the new frame. Skips when bond state
   * isn't registered (e.g. `DrawBondModifier` is disabled).
   */
  public refreshBondPositions(frame: Frame): void {
    const atomsBlock = frame.getBlock("atoms");
    const bondsBlock = frame.getBlock("bonds");
    if (!atomsBlock || !bondsBlock) return;

    const x = atomsBlock.viewColF("x");
    const y = atomsBlock.viewColF("y");
    const z = atomsBlock.viewColF("z");
    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!x || !y || !z || !bondState) return;

    refreshBondPositions(
      bondsBlock,
      x,
      y,
      z,
      bondState,
      computeBondMIDisplacements(frame, atomsBlock, bondsBlock),
    );
  }

  // ============ Single Entity Drawing ============

  public async drawAtom(
    position: Vector3,
    options: DrawAtomOptions,
  ): Promise<{ atomId: number; meshId: number }> {
    const atomId = options.atomId ?? this.app.world.sceneIndex.getNextAtomId();
    const element = options.element;
    const style = this.app.styleManager.getAtomStyle(element);
    const radius = options.radius || style.radius;
    const scale = radius * 2;

    const c = Color3.FromHexString(style.color).toLinearSpace();

    const values = new Map<string, Float32Array>();

    const matrix = new Float32Array(16);
    matrix[0] = scale;
    matrix[5] = scale;
    matrix[10] = scale;
    matrix[15] = 1;
    matrix[12] = position.x;
    matrix[13] = position.y;
    matrix[14] = position.z;
    values.set("matrix", matrix);

    values.set(
      "instanceData",
      new Float32Array([position.x, position.y, position.z, radius]),
    );
    values.set(
      "instanceColor",
      new Float32Array([c.r, c.g, c.b, style.alpha ?? 1.0]),
    );
    values.set("instancePickingColor", new Float32Array(4));

    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: 1,
        bondCount: 0,
      }),
    );

    this.app.world.sceneIndex.createAtom(
      {
        atomId,
        element,
        position: { x: position.x, y: position.y, z: position.z },
      },
      values,
    );
    this.applySceneIndexToMeshes();

    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    const meshId = atomState ? atomState.mesh.uniqueId : 0;
    return { atomId, meshId };
  }

  public async drawBond(
    start: Vector3,
    end: Vector3,
    options: DrawBondOptions = {},
  ): Promise<{ bondId: number; meshId: number }> {
    const bondId = options.bondId ?? this.app.world.sceneIndex.getNextBondId();
    const order = clampBondOrder(options.order ?? 1);
    const bondRadius =
      options.radius || this.app.styleManager.getBondStyle(order).radius;

    const atomId1 = options.atomId1 ?? 0;
    const atomId2 = options.atomId2 ?? 0;
    const c0 = this.getAtomColor(atomId1);
    const c1 = this.getAtomColor(atomId2);

    const r0 = this.getAtomRadius(atomId1);
    const r1 = this.getAtomRadius(atomId2);
    const splitOffset = (r0 - r1) * 0.5;

    const { buffers: subBuffers, subCount } = buildSubBondInstanceBuffers(
      start,
      end,
      order,
      bondRadius,
      c0,
      c1,
      splitOffset,
    );

    const values = new Map<string, Float32Array>(subBuffers);
    // Picking color is filled by ImpostorState.writePickingColor per sub-slot.
    values.set("instancePickingColor", new Float32Array(4 * subCount));

    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: 0,
        bondCount: 1,
      }),
    );

    this.app.world.sceneIndex.createBond(
      {
        bondId,
        atomId1,
        atomId2,
        order,
        start: { x: start.x, y: start.y, z: start.z },
        end: { x: end.x, y: end.y, z: end.z },
      },
      values,
      subCount,
    );
    this.applySceneIndexToMeshes();

    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    const meshId = bondState ? bondState.mesh.uniqueId : 0;
    return { bondId, meshId };
  }

  public deleteAtom(meshId: number, atomId: number): void {
    this.app.world.sceneIndex.unregisterEditAtom(meshId, atomId);
    this.applySceneIndexToMeshes();
  }

  public selectByExpression(expression: string): void {
    this.app.world.selectionManager.selectByExpression(expression);
  }

  public deleteBond(meshId: number, bondId: number): void {
    this.app.world.sceneIndex.unregisterEditBond(meshId, bondId);
    this.applySceneIndexToMeshes();
  }

  public async drawAtomFromBuffers(
    meta: Omit<AtomMeta, "type">,
    buffers: Map<string, Float32Array | number[]>,
  ): Promise<void> {
    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: 1,
        bondCount: 0,
      }),
    );
    this.app.world.sceneIndex.createAtom(meta, buffers);
    this.applySceneIndexToMeshes();
  }

  public async drawBondFromBuffers(
    meta: Omit<BondMeta, "type">,
    buffers: Map<string, Float32Array | number[]>,
  ): Promise<void> {
    await this.ensureShadersForVisibleGeometry(
      this.collectVisibleTargets({
        atomCount: 0,
        bondCount: 1,
      }),
    );
    // Infer subCount from matrix buffer length (16 floats per render instance).
    const matrix = buffers.get("matrix");
    const matrixLen = Array.isArray(matrix) ? matrix.length : matrix?.length;
    const subCount = Math.max(1, Math.floor((matrixLen ?? 16) / 16));
    this.app.world.sceneIndex.createBond(meta, buffers, subCount);
    this.applySceneIndexToMeshes();
  }

  public async redrawRepresentation(frame?: Frame, box?: Box): Promise<void> {
    if (!frame) {
      this.redrawFromSceneIndex();
      return;
    }
    await this.drawFrame(frame, box);
  }

  /**
   * Drive the ribbon renderer from a frame's `residues` block. Owned
   * by `DrawRibbonModifier` — the artist no longer reads any
   * representation-level ribbon flag, so attach/detach of the
   * modifier is the sole visibility control. A frame without a
   * `residues` block produces no mesh (RibbonRenderer is no-op safe).
   */
  public drawRibbon(
    frame: Frame,
    style?: import("./artist/ribbon/ribbon_style").RibbonStyle,
  ): void {
    this.ribbonRenderer.syncFromFrame(frame, style);
    this.ribbonRenderer.setVisible(true);
  }

  /**
   * Drive the isosurface renderer from a frame's `grid` block. Owned by
   * `DrawIsosurfaceModifier`; called from its `apply()` so the surface
   * tracks frame changes and modifier-style edits. Frames without a 3-D
   * `grid` block produce no mesh (IsosurfaceRenderer is no-op safe).
   */
  public drawIsosurface(
    frame: Frame,
    style: IsosurfaceStyle = DEFAULT_ISOSURFACE_STYLE,
  ): void {
    this.isosurfaceRenderer.rebuild(frame, style);
    this.isosurfaceRenderer.setVisible(true);
  }

  public redrawFromSceneIndex(frame?: Frame): void {
    this.applySceneIndexToMeshes();

    const sliceMod = findSliceModifier(this.app.modifierPipeline);
    updateVisualGuide(this.app.world.scene, sliceMod);
    if (frame && sliceMod?.visibilityMask) {
      this.applySliceVisibility(sliceMod.visibilityMask, frame);
    }
  }

  // ============ Private Helpers ============

  private registerRuntimeLayers(): void {
    const meshRegistry = this.app.world.sceneIndex.meshRegistry;
    meshRegistry.registerAtomLayer(this.atomMesh);
    meshRegistry.registerBondLayer(this.bondMesh);
  }

  /**
   * Data-driven auxiliary rendering layers that don't yet have
   * dedicated `Draws`-capability modifiers. Currently empty — grid
   * (cube / CHGCAR volumetric) rendering moved into
   * `DrawIsosurfaceModifier`; the previous implicit point-cloud
   * fallback would duplicate the isosurface mesh and place points
   * outside the simbox.
   *
   * Kept as a no-op stub so the call site in `app.applyPipeline`
   * doesn't have to special-case a missing method. Add a new branch
   * here only when introducing a new always-on render layer that
   * doesn't fit the modifier model.
   */
  public renderAuxiliaryLayers(_frame: Frame): void {
    // Tear down any stale cloud mesh left over from the legacy
    // auto-render path. Idempotent — `dispose()` is safe to call when
    // there is no mesh.
    if (this.cloudMesh) {
      this.cloudMesh.dispose();
      this.cloudMesh = null;
    }
  }

  private createBaseMesh(
    name: string,
    materialName: string,
    scene: Scene,
  ): Mesh {
    let material = scene.getMaterialByName(
      materialName,
    ) as ShaderMaterial | null;
    if (!material) {
      const target = materialName.includes("atom") ? "atom" : "bond";
      material = createImpostorMaterial(target, scene, this.app);
    }

    const mesh = MeshBuilder.CreatePlane(name, { size: 1.0 }, scene);
    mesh.material = material;
    mesh.freezeWorldMatrix();
    mesh.isVisible = false;
    mesh.setEnabled(false);
    mesh.thinInstanceCount = 0;
    // Thin-instanced impostor host mesh — the host plane is 1×1 in
    // model space; thin-instance bounding info should track all
    // instances after `thinInstanceRefreshBoundingInfo`, but the
    // combination of `freezeWorldMatrix()` and certain camera
    // orientations can leave the host's effective bounds tight to the
    // 1×1 plane and cause Babylon to cull the entire mesh in one go.
    // `alwaysSelectAsActiveMesh = true` opts this mesh out of frustum
    // culling — the actual rasterization still respects the camera so
    // no overdraw occurs; we just guarantee the mesh is never silently
    // dropped from the active mesh list.
    mesh.alwaysSelectAsActiveMesh = true;
    // Pin atoms/bonds to a low `alphaIndex` so they always sort
    // *before* translucent surfaces (isosurface lobes, ribbons) in the
    // alpha-blend pass. Atoms write depth via `forceDepthWrite=true`;
    // when a surface with `needDepthPrePass=true` happens to sort
    // first by camera-distance, its front-face depth pre-pass writes a
    // smaller z than atoms inside the lobe and fully blocks them on
    // the GL_LESS depth test. Atoms-first ordering keeps atoms in the
    // depth buffer; surfaces render after and only partially blend
    // with the existing atom pixels.
    //
    // 1 puts atoms after the cloud (alphaIndex=0) but before any
    // mesh that defaults to MAX_VALUE — surface, ribbon, etc.
    mesh.alphaIndex = 1;
    return mesh;
  }

  private collectVisibleTargets(counts: {
    atomCount: number;
    bondCount: number;
  }): ImpostorTarget[] {
    const repr = this.app.styleManager.getRepresentation();
    const targets: ImpostorTarget[] = [];

    if (repr.showAtoms && counts.atomCount > 0) {
      targets.push("atom");
    }
    if (repr.showBonds && counts.bondCount > 0) {
      targets.push("bond");
    }

    return targets;
  }

  public applySceneIndexToMeshes(): void {
    const repr = this.app.styleManager.getRepresentation();
    this.applyStateToMesh(
      this.app.world.sceneIndex.meshRegistry.getAtomState(),
      this.atomMesh,
      repr.showAtoms,
    );
    this.applyStateToMesh(
      this.app.world.sceneIndex.meshRegistry.getBondState(),
      this.bondMesh,
      repr.showBonds,
    );
  }

  private applyStateToMesh(
    state: ImpostorState | null,
    mesh: Mesh,
    allowVisible: boolean,
  ): void {
    const totalCount = state?.getTotalCount() ?? 0;

    if (totalCount === 0) {
      mesh.isVisible = false;
      mesh.setEnabled(false);
      mesh.thinInstanceCount = 0;
      state?.markUploaded();
      return;
    }

    if (!allowVisible) {
      mesh.isVisible = false;
      mesh.setEnabled(false);
      return;
    }

    if (state?.needsUpload) {
      const matrixDesc = state.buffers.get("matrix");
      if (matrixDesc) {
        const view = matrixDesc.data.subarray(
          0,
          totalCount * matrixDesc.stride,
        );
        mesh.thinInstanceSetBuffer("matrix", view, matrixDesc.stride, false);
      }

      for (const [name, desc] of state.buffers) {
        if (name === "matrix") continue;
        const view = desc.data.subarray(0, totalCount * desc.stride);
        mesh.thinInstanceSetBuffer(name, view, desc.stride, false);
      }

      mesh.thinInstanceCount = totalCount;
      mesh.thinInstanceEnablePicking = true;
      mesh.thinInstanceRefreshBoundingInfo(true);
      state.markUploaded();
    }

    mesh.setEnabled(true);
    mesh.isVisible = true;
  }

  /**
   * Apply slice modifier visibility mask to atom and bond colors.
   */
  private applySliceVisibility(visMask: boolean[], frame: Frame): void {
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) return;

    const instanceColorDesc = atomState.buffers.get("instanceColor");
    if (!instanceColorDesc) return;

    const totalCount = atomState.frameOffset + atomState.count;
    for (let i = 0; i < totalCount; i++) {
      instanceColorDesc.data[i * 4 + 3] = visMask[i] ? 1.0 : 0.0;
    }
    atomState.uploadBuffer("instanceColor");

    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState) return;

    const bondColor0 = bondState.buffers.get("instanceColor0");
    const bondColor1 = bondState.buffers.get("instanceColor1");
    const bondsBlock = frame.getBlock("bonds");
    if (!bondsBlock || !bondColor0 || !bondColor1) return;

    const iAtoms = bondsBlock.viewColU32("atomi");
    const jAtoms = bondsBlock.viewColU32("atomj");
    const orderCol =
      bondsBlock.dtype("order") === DType.U32
        ? bondsBlock.viewColU32("order")
        : undefined;

    // Iterate with a running render index that advances by the bond's order,
    // because multi-order bonds expand to multiple GPU instances.
    const logicalCount = bondsBlock.nrows();
    let renderIdx = 0;
    for (let b = 0; b < logicalCount; b++) {
      const order = orderCol ? orderCol[b] : 1;
      const alpha = !visMask[iAtoms[b]] || !visMask[jAtoms[b]] ? 0.0 : 1.0;
      for (let s = 0; s < order && renderIdx < bondState.frameOffset; s++) {
        bondColor0.data[renderIdx * 4 + 3] = alpha;
        bondColor1.data[renderIdx * 4 + 3] = alpha;
        renderIdx++;
      }
    }
    bondState.uploadBuffer("instanceColor0");
    bondState.uploadBuffer("instanceColor1");
  }

  private getAtomColor(atomId: number): Float32Array {
    const meta = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(atomId);
    const element = meta ? meta.element : "C";
    const s = this.app.styleManager.getAtomStyle(element);
    const c = Color3.FromHexString(s.color).toLinearSpace();
    return new Float32Array([c.r, c.g, c.b, s.alpha ?? 1.0]);
  }

  private getAtomRadius(atomId: number): number {
    const meta = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(atomId);
    const element = meta ? meta.element : "C";
    return this.app.styleManager.getAtomStyle(element).radius;
  }
}
