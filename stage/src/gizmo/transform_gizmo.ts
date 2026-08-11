import {
  PositionGizmo,
  Quaternion,
  RotationGizmo,
  type Scene,
  TransformNode,
  UtilityLayerRenderer,
} from "@babylonjs/core";
import { WORLD_AXIS_COLORS } from "./world_axes";
import {
  bindPositionGizmoToWorldAxes,
  bindRotationGizmoToWorldAxes,
} from "./world_axes_binding";

export type TransformGizmoTool = "move" | "rotate";

/** Drag lifecycle callbacks, fired by whichever tool is active. */
export interface TransformGizmoDragHandlers {
  onDragStart: () => void;
  onDrag: () => void;
  onDragEnd: () => void;
}

/** Plain world position — structural, so callers need no Babylon Vector3. */
export interface PivotPosition {
  x: number;
  y: number;
  z: number;
}

const GIZMO_THICKNESS = 1.25;
const ROTATION_RING_TESSELLATION = 64;
const IDENTITY_ROTATION = Quaternion.Identity();

/**
 * Constant on-screen gizmo size (Blender/Maya style), via Babylon
 * `updateScale = true`: root scaling = scaleRatio × camera distance (or
 * ortho height), so the rings keep this apparent size at any zoom. The
 * ring's intrinsic diameter is 0.2 units, so 1.0 ≈ one fifth of the
 * vertical field of view — large enough to grab, small enough to never
 * swallow the selection.
 */
const GIZMO_SCREEN_SCALE = 1.0;

/**
 * World-axis-locked move/rotate gizmo pair around a shared pivot.
 *
 * Owns the utility layer, the pivot TransformNode and both Babylon gizmos;
 * exactly one tool is attached at a time. Ring/arrow colors and orientation
 * are forced onto the shared world-axis triad once per attach —
 * Babylon never rewrites the per-axis `_gizmoMesh` after construction, so
 * no per-frame re-binding is needed.
 *
 * The pivot is the single source of drag feedback: Babylon writes the drag
 * delta into `pivot.position` (move) or `pivot.rotationQuaternion` (rotate),
 * which callers read via {@link pivotPosition} / {@link pivotRotation}.
 */
export class TransformGizmo {
  /** Exposed for tests and advanced tuning; do not re-wire observables. */
  public readonly positionGizmo: PositionGizmo;
  public readonly rotationGizmo: RotationGizmo;

  private readonly layer: UtilityLayerRenderer;
  private readonly pivot: TransformNode;
  private tool: TransformGizmoTool = "rotate";
  private visible = false;

  constructor(scene: Scene, handlers: TransformGizmoDragHandlers) {
    // Dedicated utility layer so gizmo meshes never collide with atom picking.
    const layer = new UtilityLayerRenderer(scene);
    layer.utilityLayerScene.autoClearDepthAndStencil = false;
    this.layer = layer;

    const pivot = new TransformNode("molvis-transform-gizmo-pivot", scene);
    pivot.rotationQuaternion = Quaternion.Identity();
    pivot.setEnabled(false);
    this.pivot = pivot;

    const pos = new PositionGizmo(layer, GIZMO_THICKNESS);
    pos.updateGizmoRotationToMatchAttachedMesh = false;
    pos.updateScale = true;
    pos.scaleRatio = GIZMO_SCREEN_SCALE;
    pos.attachedNode = null;
    bindPositionGizmoToWorldAxes(pos);
    this.positionGizmo = pos;

    // Constructor colors also feed the drag-arc shader (rotationColor), which
    // bindRotationGizmoToWorldAxes cannot repaint — pass them here.
    const rot = new RotationGizmo(
      layer,
      ROTATION_RING_TESSELLATION,
      /* useEulerRotation */ false,
      GIZMO_THICKNESS,
      undefined,
      {
        xOptions: { color: WORLD_AXIS_COLORS.x.clone() },
        yOptions: { color: WORLD_AXIS_COLORS.y.clone() },
        zOptions: { color: WORLD_AXIS_COLORS.z.clone() },
      },
    );
    rot.updateGizmoRotationToMatchAttachedMesh = false;
    rot.updateScale = true;
    rot.scaleRatio = GIZMO_SCREEN_SCALE;
    rot.attachedNode = null;
    bindRotationGizmoToWorldAxes(rot);
    this.rotationGizmo = rot;

    for (const gizmo of [pos, rot] as const) {
      gizmo.onDragStartObservable.add(() => handlers.onDragStart());
      gizmo.onDragObservable.add(() => handlers.onDrag());
      gizmo.onDragEndObservable.add(() => handlers.onDragEnd());
    }
  }

  public getTool(): TransformGizmoTool {
    return this.tool;
  }

  /** Switch the active tool; re-attaches immediately when visible. */
  public setTool(tool: TransformGizmoTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.applyAttachment();
  }

  /**
   * Show the active tool at `position` (rings/arrows keep a constant
   * on-screen size). Resets the pivot orientation to identity so the next
   * rotate gesture reports a pure delta.
   */
  public show(position: PivotPosition): void {
    this.visible = true;
    this.setPose(position, IDENTITY_ROTATION);
    this.applyAttachment();
  }

  /** Detach and hide both tools (empty selection / mode leave). */
  public hide(): void {
    this.visible = false;
    this.applyAttachment();
  }

  /** Park the pivot at an explicit pose without touching attachment. */
  public setPose(position: PivotPosition, rotation: Quaternion): void {
    this.pivot.position.set(position.x, position.y, position.z);
    if (this.pivot.rotationQuaternion) {
      this.pivot.rotationQuaternion.copyFrom(rotation);
    } else {
      this.pivot.rotationQuaternion = rotation.clone();
    }
    this.pivot.computeWorldMatrix(true);
  }

  /** Live pivot position — Babylon writes the move-drag delta here. */
  public get pivotPosition(): PivotPosition {
    const p = this.pivot.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Live pivot orientation — Babylon writes the rotate-drag delta here. */
  public get pivotRotation(): Quaternion {
    return this.pivot.rotationQuaternion ?? Quaternion.Identity();
  }

  /** True while a gizmo handle is hovered or dragged (pointer ownership). */
  public get isPointerActive(): boolean {
    return Boolean(
      this.positionGizmo.isHovered ||
        this.positionGizmo.isDragging ||
        this.rotationGizmo.isHovered ||
        this.rotationGizmo.isDragging,
    );
  }

  /**
   * Attach exactly the active tool (or none) and re-assert world-axis
   * binding — attach is the only moment Babylon could have re-posed gizmo
   * internals, so binding here (not per frame) is sufficient.
   */
  private applyAttachment(): void {
    if (!this.visible) {
      this.positionGizmo.attachedNode = null;
      this.rotationGizmo.attachedNode = null;
      this.pivot.setEnabled(false);
      return;
    }

    this.pivot.setEnabled(true);

    if (this.tool === "move") {
      this.rotationGizmo.attachedNode = null;
      this.positionGizmo.attachedNode = this.pivot;
      bindPositionGizmoToWorldAxes(this.positionGizmo);
    } else {
      this.positionGizmo.attachedNode = null;
      this.rotationGizmo.attachedNode = this.pivot;
      bindRotationGizmoToWorldAxes(this.rotationGizmo);
    }
  }

  public dispose(): void {
    this.hide();
    this.positionGizmo.dispose();
    this.rotationGizmo.dispose();
    this.layer.dispose();
    this.pivot.dispose();
  }
}
