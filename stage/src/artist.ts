import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  type ShaderMaterial,
  Vector3,
} from "@babylonjs/core";
import { toRowIndex } from "@molcrafts/molvis-core";
import type { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { NDArray } from "@molcrafts/molvis-core/molrs";
import type { GridField } from "./algo/surface/grid_field";
import type { SurfacePart } from "./algo/surface_mesh";
import type { MolvisApp } from "./app";
import {
  type AtomBufferOptions,
  refreshAtomPositions,
} from "./artist/atom_buffer";
import {
  buildSubBondInstanceBuffers,
  refreshBondPositions,
  subBondCount,
} from "./artist/bond_buffer";
import { BondTopology } from "./artist/bond_topology";
import { LabelRenderer } from "./artist/label_renderer";
import {
  compileShaderMaterial,
  createImpostorMaterial,
  syncImpostorMaterialUniforms,
} from "./artist/material_factory";
import {
  getImpostorMaterialSpec,
  type ImpostorTarget,
} from "./artist/material_spec";
import {
  drawAtomsRepresentation,
  drawBondsRepresentation,
  type RepresentationDrawHost,
  resolveAtomColorForBondsFallback,
} from "./artist/representation_draw";
import { RibbonRenderer } from "./artist/ribbon/ribbon_renderer";
import { ShaderCompileTracker } from "./artist/shader_compile_tracker";
import {
  colorForRole,
  DEFAULT_SURFACE_DRAW_STYLE,
  type SurfaceDrawStyle,
  SurfaceMeshRenderer,
} from "./artist/surface/surface_mesh_renderer";
import {
  VolumeCloudRenderer,
  type VolumeCloudStyle,
} from "./artist/surface/volume_cloud_renderer";
import { findSliceModifier, updateVisualGuide } from "./artist/visual_guide";
import { createWarmupMesh } from "./artist/warmup";
import type { AtomMeta, BondMeta } from "./entity_source";
import type { ImpostorState } from "./scene_index";
import { registerImpostorShaders } from "./shaders/impostor";
import { isMetalElement } from "./system/elements";
import {
  displayBondOrder,
  lewisOrderToBondCols,
  resolveBondOrders,
} from "./utils/bond_order";

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
 * Options for drawing a single bond.
 *
 * Prefer molrs `bondType` / `bondNumber`. `order` is edit-UI shorthand for
 * Lewis 1|2|3 (`bond_type = bond_number = order`).
 */
export interface DrawBondOptions {
  bondType?: number;
  bondNumber?: number;
  /** Edit toolbar Lewis order 1|2|3 — ignored when bondType is set. */
  order?: number;
  /**
   * Stick count override for multi-bond GPU layout (e.g. Kekulé phase from
   * {@link resolveBondOrders}). Chemistry meta still uses bondType/bondNumber.
   */
  sticks?: number;
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
 * `undefined` when there is no box, no bonds, or the required
 * columns/views are missing.
 *
 * Why in WASM: `Box.delta` knows per-axis PBC flags and the full `h`
 * cell matrix, so triclinic cells and partial-PBC setups (e.g. 2D
 * slabs with z non-periodic) get correct minimum-image handling for
 * free — no JS-side axis-length approximation.
 *
 * **Wrap-gate contract:** atom coordinates are already post-gate (see
 * pipeline compose → wrap? → draws). This is not a second full-frame
 * wrap into the cell — it only chooses the nearest image of endpoint j
 * relative to i when *drawing* a stick, so straddling pairs (as-deposited
 * or after per-atom wrap) still look bonded.
 *
 * The returned array is a view over module-level scratch storage and
 * is overwritten on the next call. Callers consume it synchronously
 * inside one render/refresh and must not retain it across frames.
 */
function computeBondMIDisplacements(
  frame: Frame,
  atomsBlock: Block,
  bondsBlock: Block,
  topology: BondTopology | undefined = BondTopology.of(bondsBlock),
): Float64Array | undefined {
  const box = frame.box;
  if (!box) return undefined;
  const nbonds = bondsBlock.nRows;
  if (nbonds === 0 || !topology) return undefined;
  const { atomi: iAtoms, atomj: jAtoms } = topology;

  const x = atomsBlock.view("x") as Float64Array;
  const y = atomsBlock.view("y") as Float64Array;
  const z = atomsBlock.view("z") as Float64Array;
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
  const aArr = NDArray.from(aBuf.subarray(0, flatLen), shape);
  const bArr = NDArray.from(bBuf.subarray(0, flatLen), shape);
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

/**
 * Artist — Unified Graphics Engine
 *
 * Orchestrates rendering by delegating to focused modules:
 * - material_factory: shader material creation + compilation
 * - atom_buffer / bond_buffer: GPU buffer computation (pure math)
 * - representation_draw: atom/bond frame registration for styles
 * - visual_guide: slice modifier wireframe
 * - warmup: shader pre-compilation
 */
export class Artist {
  private app: MolvisApp;
  private _globalOpacity = 1.0;
  private shaderCompiles = new ShaderCompileTracker<ImpostorTarget>();
  /**
   * Topology the last full bond build used. Position-only refreshes reuse
   * it (the `"position"` changeKind guarantees identical bond columns);
   * every full build / clear replaces it.
   */
  private frameBondTopology: BondTopology | null = null;

  public atomMesh: Mesh;
  public bondMesh: Mesh;
  public ribbonRenderer: RibbonRenderer;
  /** One surface renderer per owning modifier — see {@link surfaceLayer}. */
  private surfaceLayers = new Map<string, SurfaceMeshRenderer>();
  private cloudLayers = new Map<string, VolumeCloudRenderer>();
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

    const iAtoms = bondsBlock.view("atomi") as BigUint64Array;
    const jAtoms = bondsBlock.view("atomj") as BigUint64Array;
    if (!iAtoms || !jAtoms) return;
    const orderCol = resolveBondOrders(bondsBlock);

    const logicalCount = bondsBlock.nRows;
    let renderIdx = 0;
    for (let b = 0; b < logicalCount; b++) {
      // Must match buildBondBuffers' per-bond instance count exactly, or the
      // running renderIdx drifts and opacity lands on the wrong sticks.
      const sticks =
        this.app.styleManager.getRepresentation().bondOrderMode === "multiple"
          ? subBondCount(orderCol?.[b] ?? 1)
          : 1;
      const hit =
        atomIndices.has(toRowIndex(iAtoms[b])) ||
        atomIndices.has(toRowIndex(jAtoms[b]));
      for (let s = 0; s < sticks && renderIdx < bondState.frameOffset; s++) {
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
    this.labelRenderer = new LabelRenderer(scene);
    this.registerRuntimeLayers();
  }

  // ============ Shader Preparation ============

  private async ensureShadersForVisibleGeometry(
    targets: ImpostorTarget[],
  ): Promise<void> {
    if (targets.length === 0) return;

    // A render pass is what makes Babylon bind the material and start the
    // compile; once every visible target is ready it is a wasted frame.
    if (this.shaderCompiles.needsWarmRender(targets)) {
      this.app.world.renderOnce();
    }
    await Promise.all(
      targets.map((target) => this.ensureTargetShaderReady(target)),
    );
  }

  private ensureTargetShaderReady(target: ImpostorTarget): Promise<void> {
    return this.shaderCompiles.ensure(target, () => {
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

      return compileShaderMaterial(warmupMesh ?? mesh, material, spec).finally(
        () => {
          warmupMesh?.dispose();
        },
      );
    });
  }

  // ============ Scene Lifecycle ============

  public clear(): void {
    const scene = this.app.world.scene;

    this.atomMesh.dispose();
    this.bondMesh.dispose();

    // Dispose box mesh if present
    const boxMesh = scene.getMeshByName("sim_box");
    if (boxMesh) {
      boxMesh.dispose();
    }

    // Frame-derived auxiliary meshes — ribbon backbone strips and atom
    // text labels are owned by their own renderers but still belong to
    // "current scene content", so they must go when atoms/bonds do.
    // Without these calls, Clear leaves ghost ribbons/labels
    // floating over an otherwise empty viewport.
    this.ribbonRenderer.dispose();
    this.disposeSurfaceLayers();
    this.labelRenderer.clearLabels();

    this.app.world.sceneIndex.clear();
    this.frameBondTopology = null;

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
    this.ribbonRenderer.dispose();
    this.disposeSurfaceLayers();
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
    this.applySliceMaskIfPresent(frame);
    this.app.world.sceneIndex.markAllSaved();
    // A full redraw: this path clears and rebuilds both layers.
    this.app.events.emit("frame-rendered", {
      frame,
      box: _box,
      changeKind: "full",
    });
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
  private representationDrawHost(): RepresentationDrawHost {
    return {
      app: this.app,
      atomMesh: this.atomMesh,
      bondMesh: this.bondMesh,
      labelRenderer: this.labelRenderer,
      ensureShadersForVisibleGeometry: (targets) =>
        this.ensureShadersForVisibleGeometry(targets),
      collectVisibleTargets: (counts) => this.collectVisibleTargets(counts),
      resolveAtomColorForBonds: (atomsBlock) =>
        this.resolveAtomColorForBonds(atomsBlock),
      computeBondMIDisplacements: (frame, atomsBlock, bondsBlock) =>
        computeBondMIDisplacements(frame, atomsBlock, bondsBlock),
    };
  }

  public async drawAtoms(
    frame: Frame,
    options?: AtomBufferOptions & { impostor?: boolean },
  ): Promise<void> {
    await drawAtomsRepresentation(
      this.representationDrawHost(),
      frame,
      options,
    );
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
    this.frameBondTopology =
      (await drawBondsRepresentation(
        this.representationDrawHost(),
        frame,
        options,
      )) ?? null;
  }

  /**
   * Bond bicolor coloring needs per-atom RGBA. Reuse the already-
   * registered atom buffer when `DrawAtomModifier` ran first;
   * otherwise compute a fresh color-only buffer (the bond layer
   * still works when atoms are disabled). Encapsulates the
   * impostor-state probe so modifiers don't reach into buffers.
   */
  private resolveAtomColorForBonds(atomsBlock: Block): Float32Array {
    return resolveAtomColorForBondsFallback(this.app, atomsBlock);
  }

  /**
   * Shared "apply slice mask if a SliceModifier is in the pipeline".
   * Used by the `drawFrame()` composer path and by `applyPipeline()`
   * after the pipeline has run.
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

    const corners = copyAndFree(box.corners()); // length 24

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

  // ============ Frame Refresh (Fast Path) ============

  /**
   * Update atom positions in place — no buffer realloc, no topology
   * rebuild, no mesh dispose. Used by `DrawAtomModifier` on the
   * position-only fast path during trajectory playback.
   */
  public refreshAtomPositions(frame: Frame): void {
    const atomsBlock = frame.has("atoms") ? frame.get("atoms") : undefined;
    if (!atomsBlock || atomsBlock.nRows === 0) return;

    const x = atomsBlock.view("x") as Float64Array;
    const y = atomsBlock.view("y") as Float64Array;
    const z = atomsBlock.view("z") as Float64Array;
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!x || !y || !z || !atomState) return;

    refreshAtomPositions(x, y, z, atomState);
    this.labelRenderer.updatePositions(x, y, z);
  }

  /**
   * Update bond positions in place. Recomputes bond endpoints from
   * the atom coordinates in the new frame. Skips when bond state
   * isn't registered (e.g. `DrawBondModifier` is disabled).
   */
  public refreshBondPositions(frame: Frame): void {
    const atomsBlock = frame.has("atoms") ? frame.get("atoms") : undefined;
    const bondsBlock = frame.has("bonds") ? frame.get("bonds") : undefined;
    if (!atomsBlock || !bondsBlock) return;

    const x = atomsBlock.view("x") as Float64Array;
    const y = atomsBlock.view("y") as Float64Array;
    const z = atomsBlock.view("z") as Float64Array;
    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!x || !y || !z || !bondState) return;

    // Carried from the last full build; the row-count check only guards a
    // gross mismatch, `"position"` already means identical bond columns.
    const carried = this.frameBondTopology;
    const topology =
      carried !== null && carried.bondCount === bondsBlock.nRows
        ? carried
        : BondTopology.of(bondsBlock);
    if (!topology) return;

    refreshBondPositions(
      bondsBlock,
      x,
      y,
      z,
      bondState,
      computeBondMIDisplacements(frame, atomsBlock, bondsBlock, topology),
      this.app.styleManager.getRepresentation().bondOrderMode,
      topology,
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
    const atomVisibility =
      this.app.styleManager.getRepresentation().atomVisibility;
    const representationVisible =
      atomVisibility === "all" ||
      atomVisibility === "tube-joints" ||
      atomVisibility === "metal-tube-joints" ||
      (atomVisibility === "metals" && isMetalElement(element));
    values.set(
      "instanceStyle",
      new Float32Array([
        representationVisible ? 1 : 0,
        0,
        this.app.styleManager.getRepresentation().labels === "skeletal" ? 1 : 0,
        0,
      ]),
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
    const representation = this.app.styleManager.getRepresentation();
    // molrs columns win; `order` is edit-UI Lewis shorthand only.
    let bondType: number;
    let bondNumber: number;
    if (options.bondType != null) {
      bondType = options.bondType;
      bondNumber = options.bondNumber ?? 0;
    } else {
      const cols = lewisOrderToBondCols(options.order ?? 1);
      bondType = cols.type;
      bondNumber = cols.number;
    }
    const sticks =
      representation.bondOrderMode === "multiple"
        ? (options.sticks ?? displayBondOrder(bondType, bondNumber))
        : 1;
    const bondRadius =
      options.radius || this.app.styleManager.getBondStyle(sticks).radius;

    const atomId1 = options.atomId1 ?? 0;
    const atomId2 = options.atomId2 ?? 0;
    let c0 = this.getAtomColor(atomId1);
    let c1 = this.getAtomColor(atomId2);
    if (representation.bondColorMode === "theme") {
      const style = this.app.styleManager.getBondStyle(sticks);
      const c = Color3.FromHexString(style.color).toLinearSpace();
      c0 = new Float32Array([c.r, c.g, c.b, style.alpha ?? 1]);
      c1 = c0;
    }

    const r0 = this.getAtomRadius(atomId1);
    const r1 = this.getAtomRadius(atomId2);
    const splitOffset = (r0 - r1) * 0.5;

    const offsetAxis = new Vector3();
    this.app.world.sceneIndex.bondPlaneAxis(
      atomId1,
      start,
      atomId2,
      end,
      end.subtract(start).normalize(),
      offsetAxis,
    );

    const { buffers: subBuffers, subCount } = buildSubBondInstanceBuffers(
      start,
      end,
      sticks,
      bondRadius,
      c0,
      c1,
      splitOffset,
      offsetAxis,
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
        bondType,
        bondNumber,
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
  /**
   * Paint one producer's surface parts. The producer's own id keys the layer,
   * so several surfaces coexist without overwriting each other.
   */
  public drawSurfaceParts(
    ownerId: string,
    parts: readonly SurfacePart[],
    style: SurfaceDrawStyle = DEFAULT_SURFACE_DRAW_STYLE,
  ): void {
    const layer = this.surfaceLayer(ownerId);
    layer.dispose();
    for (const [index, part] of parts.entries()) {
      layer.add(
        `surface_${index}#${ownerId}`,
        part.mesh,
        colorForRole(style, part),
        style,
      );
    }
    layer.setVisible(true);
  }

  /**
   * The surface renderer owned by `ownerId`, created on first use.
   *
   * Keyed by owner because a pipeline holds several surface draws at once — a
   * CUBE file's isosurface next to a molecular surface, say. A single shared
   * renderer made the second one silently erase the first.
   */
  public surfaceLayer(ownerId: string): SurfaceMeshRenderer {
    const existing = this.surfaceLayers.get(ownerId);
    if (existing) return existing;
    const created = new SurfaceMeshRenderer(this.app.world.scene);
    this.surfaceLayers.set(ownerId, created);
    return created;
  }

  /**
   * AABB corners of every surface layer that holds geometry, or `null` when
   * none does. `World.fit` falls back to these when there are no atoms and no
   * cell — a scene whose only content is an imported mesh.
   */
  public surfaceFramingPoints(): Float64Array | null {
    const boxes: Float64Array[] = [];
    for (const layer of this.surfaceLayers.values()) {
      const corners = layer.boundsCorners();
      if (corners) boxes.push(corners);
    }
    if (boxes.length === 0) return null;
    const merged = new Float64Array(boxes.length * 24);
    for (let i = 0; i < boxes.length; i++) merged.set(boxes[i], i * 24);
    return merged;
  }

  /** Drop `ownerId`'s meshes. Called when its modifier leaves the pipeline. */
  public releaseSurfaceLayer(ownerId: string): void {
    const layer = this.surfaceLayers.get(ownerId);
    if (!layer) return;
    layer.dispose();
    this.surfaceLayers.delete(ownerId);
  }

  public drawVolumeCloud(
    ownerId: string,
    field: GridField,
    style: VolumeCloudStyle,
  ): void {
    const layer = this.cloudLayer(ownerId);
    layer.rebuild(
      field.data,
      field.shape,
      field.cell,
      field.origin,
      style,
      field.allPeriodic,
    );
    layer.setVisible(true);
  }

  public cloudLayer(ownerId: string): VolumeCloudRenderer {
    const existing = this.cloudLayers.get(ownerId);
    if (existing) return existing;
    const created = new VolumeCloudRenderer(this.app.world.scene, ownerId);
    this.cloudLayers.set(ownerId, created);
    return created;
  }

  public releaseCloudLayer(ownerId: string): void {
    const layer = this.cloudLayers.get(ownerId);
    if (!layer) return;
    layer.dispose();
    this.cloudLayers.delete(ownerId);
  }

  private disposeSurfaceLayers(): void {
    for (const layer of this.surfaceLayers.values()) layer.dispose();
    this.surfaceLayers.clear();
    for (const layer of this.cloudLayers.values()) layer.dispose();
    this.cloudLayers.clear();
  }

  public redrawFromSceneIndex(frame?: Frame): void {
    this.applySceneIndexToMeshes();

    const sliceMod = findSliceModifier(this.app.modifierPipeline);
    updateVisualGuide(this.app.world.scene, sliceMod);
    if (frame && sliceMod?.visibilityMask) {
      this.applySliceVisibility(sliceMod.visibilityMask, frame);
    }
  }

  /**
   * Re-sample atom (and bond) impostor colors from the current theme into
   * existing SceneIndex buffers. Used by `view.set_theme` so edit-pool
   * stamps (`scene.draw_frame` without commit) recolor without a DS HEAD.
   */
  public recolorFromTheme(): void {
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    const atomsMeta = this.app.world.sceneIndex.metaRegistry.atoms;
    if (atomState) {
      const colorDesc = atomState.buffers.get("instanceColor");
      if (colorDesc) {
        const total = atomState.getTotalCount();
        for (let abs = 0; abs < total; abs++) {
          let atomId: number;
          if (abs < atomState.frameOffset) {
            // Frame segment is identity-mapped for atoms.
            atomId = abs;
          } else {
            atomId =
              atomState.indexToId.get(abs - atomState.frameOffset) ?? abs;
          }
          const meta = atomsMeta.getMeta(atomId);
          const element = meta?.element || "C";
          const style = this.app.styleManager.getAtomStyle(element);
          const c = Color3.FromHexString(style.color).toLinearSpace();
          const o = abs * 4;
          colorDesc.data[o] = c.r;
          colorDesc.data[o + 1] = c.g;
          colorDesc.data[o + 2] = c.b;
          // Preserve alpha (slice / hide masks).
        }
        atomState.uploadBuffer("instanceColor");
      }
    }

    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    const bondsMeta = this.app.world.sceneIndex.metaRegistry.bonds;
    if (bondState) {
      const c0 = bondState.buffers.get("instanceColor0");
      const c1 = bondState.buffers.get("instanceColor1");
      if (c0 && c1) {
        const total = bondState.getTotalCount();
        for (let abs = 0; abs < total; abs++) {
          let bondId: number;
          if (abs < bondState.frameOffset) {
            bondId = abs;
          } else {
            bondId =
              bondState.indexToId.get(abs - bondState.frameOffset) ?? abs;
          }
          const meta = bondsMeta.getMeta(bondId);
          // Prefer endpoint atom theme colors (split stick); fall back to
          // bond-order theme style when meta is missing.
          let col0: Float32Array;
          let col1: Float32Array;
          if (meta) {
            col0 = this.getAtomColor(meta.atomId1);
            col1 = this.getAtomColor(meta.atomId2);
          } else {
            const bs = this.app.styleManager.getBondStyle(1);
            const c = Color3.FromHexString(bs.color).toLinearSpace();
            const flat = new Float32Array([c.r, c.g, c.b, bs.alpha ?? 1]);
            col0 = flat;
            col1 = flat;
          }
          const o = abs * 4;
          c0.data[o] = col0[0];
          c0.data[o + 1] = col0[1];
          c0.data[o + 2] = col0[2];
          c1.data[o] = col1[0];
          c1.data[o + 1] = col1[1];
          c1.data[o + 2] = col1[2];
        }
        bondState.uploadBuffer("instanceColor0");
        bondState.uploadBuffer("instanceColor1");
      }
    }

    this.applySceneIndexToMeshes();
  }

  // ============ Private Helpers ============

  private registerRuntimeLayers(): void {
    const meshRegistry = this.app.world.sceneIndex.meshRegistry;
    meshRegistry.registerAtomLayer(this.atomMesh);
    meshRegistry.registerBondLayer(this.bondMesh);
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
    // dropped from the active mesh list. (Was removed in the
    // molrs-0.0.11 refactor; re-applied to fix the class of "atom
    // disappears at certain rotation angles" bugs.)
    mesh.alwaysSelectAsActiveMesh = true;
    // Pin atoms/bonds to a low `alphaIndex` so they always sort
    // *before* translucent surfaces (mark_atom halos, isosurface lobes,
    // ribbons) in the alpha-blend pass. Atoms write depth via
    // `forceDepthWrite=true`; when a surface with `needDepthPrePass=true`
    // happens to sort first by camera-distance, its front-face depth
    // pre-pass writes a smaller z than atoms inside the lobe and fully
    // blocks them on the GL_LESS depth test. Atoms-first ordering keeps
    // atoms in the depth buffer; surfaces render after and only
    // partially blend with the existing atom pixels.
    //
    // 1 puts atoms after the cloud (alphaIndex=0) but before any
    // mesh that defaults to MAX_VALUE — surface, ribbon, halo, etc.
    mesh.alphaIndex = 1;
    return mesh;
  }

  private collectVisibleTargets(counts: {
    atomCount: number;
    bondCount: number;
  }): ImpostorTarget[] {
    const repr = this.app.styleManager.getRepresentation();
    const targets: ImpostorTarget[] = [];

    if (
      (repr.atomVisibility !== "none" || repr.labels === "skeletal") &&
      counts.atomCount > 0
    ) {
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
      repr.atomVisibility !== "none" || repr.labels === "skeletal",
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
      // Upload only the buffers marked dirty. The position-only playback path
      // mutates just matrix + instanceData, so the (unchanged) color and
      // picking buffers — by far the largest — are skipped. Structural changes
      // mark everything dirty (isAllDirty) and re-upload all buffers.
      const matrixDesc = state.buffers.get("matrix");
      if (matrixDesc && state.isBufferDirty("matrix")) {
        const view = matrixDesc.data.subarray(
          0,
          totalCount * matrixDesc.stride,
        );
        mesh.thinInstanceSetBuffer("matrix", view, matrixDesc.stride, false);
      }

      for (const [name, desc] of state.buffers) {
        if (name === "matrix") continue;
        if (!state.isBufferDirty(name)) continue;
        const view = desc.data.subarray(0, totalCount * desc.stride);
        mesh.thinInstanceSetBuffer(name, view, desc.stride, false);
      }

      // thinInstanceCount/picking are idempotent; bounds must refresh whenever
      // matrices moved (which is the case on every dirty cycle that touches
      // positions). Keep these unconditional — they are cheap relative to the
      // buffer uploads we just gated.
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
    const bondsBlock = frame.has("bonds") ? frame.get("bonds") : undefined;
    if (!bondsBlock || !bondColor0 || !bondColor1) return;

    const iAtoms = bondsBlock.view("atomi") as BigUint64Array;
    const jAtoms = bondsBlock.view("atomj") as BigUint64Array;
    const orderCol = resolveBondOrders(bondsBlock);

    // Iterate with a running render index that advances by the bond's order,
    // because multi-order bonds expand to multiple GPU instances.
    const logicalCount = bondsBlock.nRows;
    let renderIdx = 0;
    for (let b = 0; b < logicalCount; b++) {
      const sticks =
        this.app.styleManager.getRepresentation().bondOrderMode === "multiple"
          ? subBondCount(orderCol?.[b] ?? 1)
          : 1;
      const alpha =
        !visMask[toRowIndex(iAtoms[b])] || !visMask[toRowIndex(jAtoms[b])]
          ? 0.0
          : 1.0;
      for (let s = 0; s < sticks && renderIdx < bondState.frameOffset; s++) {
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
