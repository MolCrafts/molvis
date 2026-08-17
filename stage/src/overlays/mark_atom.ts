/**
 * MarkAtomOverlay — a composite overlay that marks an atom.
 *
 * One mark = one atom (or one world point) + an optional shape + an optional
 * text label, managed as a single unit with a single id. Intended for
 * annotating pSMILES / bigSMILES endpoints, reactive sites, or atoms flagged
 * by external analyses.
 *
 * The shape component is a pure 3D world-space mesh (translucent sphere halo).
 * The label component uses BabylonJS GUI and projects to screen each render
 * frame, so updateScreenPositions() is implemented only when a label is active.
 *
 * Atom anchoring is routed through the shared AtomAnchored protocol — the
 * per-frame sync dispatch in MolvisApp handles all anchored overlays uniformly.
 */

import type { Mesh, Scene } from "@babylonjs/core";
import {
  Axis,
  Color3,
  Matrix,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  type AdvancedDynamicTexture,
  Rectangle,
  TextBlock,
} from "@babylonjs/gui";
import type {
  AtomAnchored,
  MarkAtomProps,
  MarkLabel,
  MarkShape,
  Overlay,
  Vec3,
} from "./types";

const DEFAULT_SHAPE_COLOR = "#ffd54a";
const DEFAULT_SHAPE_OPACITY = 0.35;
const DEFAULT_SHAPE_SEGMENTS = 24;

// Halo auto-sizing: when shape.radius is not explicitly provided, the halo's
// radius is this factor × the marked atom's rendered radius. 1.5× gives a
// clear ring extending ~0.5× the atom radius outside the atom's mesh.
const HALO_TO_ATOM_RATIO = 1.5;

const DEFAULT_LABEL_COLOR = "white";

// Label dynamic-sizing clamps (screen pixels). Below 12 the text is unreadable;
// above 64 it fills the canvas at extreme zoom-in and looks silly.
const LABEL_FONT_MIN = 12;
const LABEL_FONT_MAX = 64;
// Factor applied to the atom's screen-projected pixel radius to pick font size.
// Chosen so a single character's x-height roughly matches the atom's radius.
const LABEL_FONT_PER_PIXEL_RADIUS = 1.6;

let _counter = 0;
function nextId(): string {
  return `mark_atom_${++_counter}`;
}

function hexToColor3(hex: string): Color3 {
  const h = hex.replace(/^#/, "");
  const r = Number.parseInt(h.substring(0, 2), 16) / 255;
  const g = Number.parseInt(h.substring(2, 4), 16) / 255;
  const b = Number.parseInt(h.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

type ResolvedShape = Required<MarkShape>;
type ResolvedLabel = Required<MarkLabel>;

interface ResolvedProps {
  anchorAtomId: number;
  shape: ResolvedShape | null;
  label: ResolvedLabel | null;
  name: string;
}

/**
 * Context the command layer injects when constructing a mark. Both fields
 * are resolved from the current frame so the overlay can appear at the
 * correct location immediately (no one-frame flash) and size itself from
 * the atom's rendered radius (halo = 1.5 × atomRadius, label font tracks
 * the atom's on-screen pixel radius).
 */
export interface MarkAtomContext {
  /** Rendered radius of the marked atom in Å. */
  atomRadius: number;
  /** World-space position of the marked atom at creation time. */
  initialPosition: Vec3;
}

export class MarkAtomOverlay implements Overlay, AtomAnchored {
  readonly id: string;
  readonly type = "mark_atom" as const;

  private _props: ResolvedProps;
  private _scene: Scene;
  private _uiTexture: AdvancedDynamicTexture;

  private _root: TransformNode;
  private _shapeMesh: Mesh | null = null;
  private _shapeMaterial: StandardMaterial | null = null;
  private _labelBillboard: _LabelBillboard | null = null;

  /** Current world-space center of the mark (atom pos when anchored). */
  private _worldCenter: Vector3;

  /** Rendered radius (Å) of the marked atom; drives halo & label auto-sizing. */
  private _atomRadius: number;
  /** True when the caller did not pin label.fontSize, so we scale per-frame. */
  private _labelFontSizeAuto: boolean;

  private constructor(
    id: string,
    props: ResolvedProps,
    scene: Scene,
    uiTexture: AdvancedDynamicTexture,
    atomRadius: number,
    initialPosition: Vec3,
    labelFontSizeAuto: boolean,
  ) {
    this.id = id;
    this._props = props;
    this._scene = scene;
    this._uiTexture = uiTexture;
    this._atomRadius = atomRadius;
    this._labelFontSizeAuto = labelFontSizeAuto;
    this._root = new TransformNode(`${id}_root`, scene);
    // Seed at the marked atom's position so the overlay appears in the right
    // place immediately (no one-frame flash at origin); the orchestrator
    // (MolvisApp.syncAnchoredOverlay) keeps it synced thereafter.
    this._worldCenter = new Vector3(
      initialPosition[0],
      initialPosition[1],
      initialPosition[2],
    );
    this._root.position.copyFrom(this._worldCenter);

    if (props.shape) this._createShape(props.shape);
    if (props.label) this._createLabel(props.label);
  }

  static create(
    scene: Scene,
    props: MarkAtomProps,
    uiTexture: AdvancedDynamicTexture,
    context: MarkAtomContext,
  ): MarkAtomOverlay {
    if (!Number.isInteger(props.anchorAtomId) || props.anchorAtomId < 0) {
      throw new Error(
        `MarkAtomOverlay: anchorAtomId must be a non-negative integer, got ${props.anchorAtomId}`,
      );
    }
    // Detect "auto" BEFORE resolveDefaults fills the field in. We track this
    // independently so later update() calls can transition to a fixed size.
    const labelFontSizeAuto =
      props.label != null && props.label.fontSize === undefined;
    return new MarkAtomOverlay(
      nextId(),
      resolveDefaults(props, context.atomRadius),
      scene,
      uiTexture,
      context.atomRadius,
      context.initialPosition,
      labelFontSizeAuto,
    );
  }

  get props(): Readonly<ResolvedProps> {
    return this._props;
  }

  get visible(): boolean {
    return this._root.isEnabled();
  }

  set visible(v: boolean) {
    this._root.setEnabled(v);
    this._labelBillboard?.setVisible(v);
  }

  update(patch: Partial<MarkAtomProps>): this {
    const prev = this._props;

    // Shape / label nested props: undefined = keep, null = remove,
    // object = shallow-merge onto previous so callers can patch a single field.
    let shape: MarkShape | null;
    if (patch.shape === undefined) shape = prev.shape;
    else if (patch.shape === null) shape = null;
    else shape = { ...(prev.shape ?? {}), ...patch.shape };

    let label: MarkLabel | null;
    if (patch.label === undefined) label = prev.label;
    else if (patch.label === null) label = null;
    else label = { ...(prev.label ?? { text: "" }), ...patch.label };

    let anchorAtomId = prev.anchorAtomId;
    if (patch.anchorAtomId !== undefined) {
      if (!Number.isInteger(patch.anchorAtomId) || patch.anchorAtomId < 0) {
        throw new Error(
          `MarkAtomOverlay.update: anchorAtomId must be a non-negative integer, got ${patch.anchorAtomId}`,
        );
      }
      anchorAtomId = patch.anchorAtomId;
    }

    // If the user explicitly sets label.fontSize in a patch, pin it.
    if (patch.label && patch.label.fontSize !== undefined) {
      this._labelFontSizeAuto = false;
    }

    const next = resolveDefaults(
      {
        anchorAtomId,
        shape,
        label,
        name: patch.name ?? prev.name,
      },
      this._atomRadius,
    );
    this._props = next;

    // Anchor change: keep the current world center as a visible seed until
    // the next frame-rendered event re-syncs to the new atom. Jumping to
    // origin would cause a one-frame flash at (0,0,0); keeping the old
    // position is visually safer.

    this._applyShape(next.shape);
    this._applyLabel(next.label);
    return this;
  }

  dispose(): void {
    this._disposeShape();
    this._labelBillboard?.dispose();
    this._labelBillboard = null;
    this._root.dispose();
  }

  // ── AtomAnchored ─────────────────────────────────────────────────────────

  getAnchorAtomId(): number {
    return this._props.anchorAtomId;
  }

  syncToAtomPosition(x: number, y: number, z: number): void {
    this._worldCenter.set(x, y, z);
    this._root.position.copyFrom(this._worldCenter);
  }

  // ── Per-frame label projection ───────────────────────────────────────────

  updateScreenPositions(): void {
    // Only the label needs per-frame projection; the shape lives in world space.
    this._labelBillboard?.project(
      this._scene,
      this._worldCenter,
      this._labelFontSizeAuto ? this._atomRadius : null,
    );
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _createShape(shape: ResolvedShape): void {
    const mat = new StandardMaterial(`${this.id}_mat`, this._scene);
    const color = hexToColor3(shape.color);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.4);
    mat.alpha = shape.opacity;
    mat.backFaceCulling = false;
    mat.separateCullingPass = true;
    // Translucent halo must NOT write depth: StandardMaterial defaults
    // `disableDepthWrite = false`, so the halo would write z at its
    // surface and discard the atom impostor fragment behind it on the
    // GL_LESS test — the marked atom then visibly disappears at angles
    // where the halo center sorts in front of the atom by camera
    // distance. Other translucent overlays apply the same fix for this
    // class of bug.
    mat.disableDepthWrite = true;

    const sphere = MeshBuilder.CreateSphere(
      `${this.id}_sphere`,
      {
        diameter: shape.radius * 2,
        segments: shape.segments,
      },
      this._scene,
    );
    sphere.material = mat;
    sphere.isPickable = false;
    sphere.parent = this._root;
    // Opt out of frustum culling — the parent TransformNode's position
    // updates after the bounding box is cached, so at some camera
    // orientations the (stale) world-space bounds fall outside the
    // frustum and BabylonJS culls the halo wholesale. Same fix the cloud
    // mesh uses (artist.ts:586).
    sphere.alwaysSelectAsActiveMesh = true;
    // Atom impostors render in the transparent queue (needAlphaBlending + forceDepthWrite),
    // so the halo and the marked atom share a mesh center and BabylonJS's center-distance
    // sort flips arbitrarily as the camera orbits. Push the halo to a later rendering group
    // so it always draws after atoms — same convention as target_indicator / visual_guide.
    sphere.renderingGroupId = 1;

    this._shapeMaterial = mat;
    this._shapeMesh = sphere;
  }

  private _disposeShape(): void {
    if (this._shapeMesh) {
      this._shapeMesh.dispose();
      this._shapeMesh = null;
    }
    if (this._shapeMaterial) {
      this._shapeMaterial.dispose();
      this._shapeMaterial = null;
    }
  }

  private _applyShape(next: ResolvedShape | null): void {
    if (!next) {
      this._disposeShape();
      return;
    }
    // Rebuild on shape change — sphere geometry is cheap and this keeps the
    // code paths single-flow (no partial update matrix).
    this._disposeShape();
    this._createShape(next);
  }

  private _createLabel(label: ResolvedLabel): void {
    this._labelBillboard = new _LabelBillboard(
      `${this.id}_label`,
      label,
      this._uiTexture,
    );
  }

  private _applyLabel(next: ResolvedLabel | null): void {
    if (!next) {
      this._labelBillboard?.dispose();
      this._labelBillboard = null;
      return;
    }
    if (!this._labelBillboard) {
      this._createLabel(next);
      return;
    }
    this._labelBillboard.update(next);
  }
}

// ── Private: label billboard (GUI-projected text) ───────────────────────────

/**
 * Tiny helper that owns the BabylonJS GUI controls for a single atom mark's
 * text label. Internal to this module — do not export.
 *
 * Mirrors the projection logic of TextLabelOverlay but is scoped to a
 * caller-supplied world anchor, so MarkAtomOverlay can drive position
 * from its own atom-anchor sync.
 */
class _LabelBillboard {
  private _uiTexture: AdvancedDynamicTexture;
  private _props: ResolvedLabel;
  private _id: string;

  private _container: Rectangle | null = null;
  private _textBlock: TextBlock | null = null;
  private _visible = true;

  constructor(
    id: string,
    props: ResolvedLabel,
    uiTexture: AdvancedDynamicTexture,
  ) {
    this._id = id;
    this._props = props;
    this._uiTexture = uiTexture;
    this._build();
  }

  update(next: ResolvedLabel): void {
    const textChanged = next.text !== this._props.text;
    const styleChanged =
      next.color !== this._props.color ||
      next.fontSize !== this._props.fontSize ||
      next.background !== this._props.background;
    this._props = next;

    if (styleChanged) {
      // Wholesale rebuild is simpler than reconciling a mixed Rectangle/TextBlock tree.
      this._dispose();
      this._build();
      if (!this._visible) this.setVisible(false);
    } else if (textChanged && this._textBlock) {
      this._textBlock.text = next.text;
    }
  }

  setVisible(v: boolean): void {
    this._visible = v;
    if (this._container) this._container.isVisible = v;
    if (this._textBlock) this._textBlock.isVisible = v;
  }

  project(
    scene: Scene,
    center: Vector3,
    dynamicAtomRadius: number | null,
  ): void {
    if (!this._visible) return;
    if (!this._container && !this._textBlock) return;

    const camera = scene.activeCamera;
    if (!camera) return;

    const engine = scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = scene.getTransformMatrix();

    const { offset } = this._props;
    const anchored = new Vector3(
      center.x + offset[0],
      center.y + offset[1],
      center.z + offset[2],
    );

    // World matrix MUST be identity for world-space points; passing
    // transformMatrix twice double-applies view*projection, mapping the
    // label rectangle to absurd screen coordinates which BabylonJS GUI
    // then re-interprets as a near-fullscreen rectangle. See
    // memory/project_babylon_project_api.md.
    const projected = Vector3.Project(
      anchored,
      Matrix.IdentityReadOnly,
      transformMatrix,
      viewportMatrix,
    );

    const control = this._container ?? this._textBlock;
    if (control) {
      // Guard against non-finite projection (e.g. behind-camera, degenerate
      // matrices). Without this, BabylonJS GUI's adaptWidthToChildren rect
      // falls back to a fullscreen layout and the label background fills
      // the entire viewport — see memory/project_babylon_project_api.md.
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
        control.isVisible = false;
        return;
      }
      control.isVisible = this._visible;
      control.left = `${projected.x - width / 2}px`;
      control.top = `${projected.y - height / 2}px`;
    }

    // Dynamic font sizing: project a probe point offset by `atomRadius` along
    // the camera's right axis. The probe is always perpendicular to the view
    // direction, so its pixel distance from `projected` is a clean measurement
    // of the atom's on-screen radius at the current zoom.
    if (dynamicAtomRadius !== null && this._textBlock) {
      const right = camera.getDirection(Axis.X);
      const probe = new Vector3(
        center.x + right.x * dynamicAtomRadius,
        center.y + right.y * dynamicAtomRadius,
        center.z + right.z * dynamicAtomRadius,
      );
      const centerProj = Vector3.Project(
        center,
        Matrix.IdentityReadOnly,
        transformMatrix,
        viewportMatrix,
      );
      const probeProj = Vector3.Project(
        probe,
        Matrix.IdentityReadOnly,
        transformMatrix,
        viewportMatrix,
      );
      const pixelRadius = Math.hypot(
        probeProj.x - centerProj.x,
        probeProj.y - centerProj.y,
      );
      const target = Math.max(
        LABEL_FONT_MIN,
        Math.min(LABEL_FONT_MAX, pixelRadius * LABEL_FONT_PER_PIXEL_RADIUS),
      );
      const rounded = Math.round(target);
      // Guard to avoid thrashing BabylonJS GUI layout on sub-pixel changes.
      if (this._textBlock.fontSizeInPixels !== rounded) {
        this._textBlock.fontSize = rounded;
      }
    }
  }

  dispose(): void {
    this._dispose();
  }

  private _build(): void {
    const { text, color, fontSize, background } = this._props;

    const tb = new TextBlock(`${this._id}_tb`, text);
    tb.color = color;
    tb.fontSize = fontSize;
    tb.outlineWidth = 2;
    tb.outlineColor = "#000000";
    tb.isHitTestVisible = false;
    tb.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
    tb.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
    // Without this, TextBlock stretches to fill its parent. Inside a
    // Rectangle with adaptWidthToChildren, that blows the container up to
    // the full AdvancedDynamicTexture (screen) size.
    tb.resizeToFit = true;

    if (background) {
      const rect = new Rectangle(`${this._id}_bg`);
      rect.background = background;
      rect.cornerRadius = 4;
      rect.thickness = 0;
      rect.paddingLeft = "4px";
      rect.paddingRight = "4px";
      rect.paddingTop = "2px";
      rect.paddingBottom = "2px";
      rect.adaptHeightToChildren = true;
      rect.adaptWidthToChildren = true;
      rect.isHitTestVisible = false;
      rect.addControl(tb);
      this._uiTexture.addControl(rect);
      this._container = rect;
      this._textBlock = tb;
    } else {
      this._uiTexture.addControl(tb);
      this._textBlock = tb;
      this._container = null;
    }
  }

  private _dispose(): void {
    if (this._container) {
      this._uiTexture.removeControl(this._container);
      this._container.dispose();
      this._container = null;
    } else if (this._textBlock) {
      this._uiTexture.removeControl(this._textBlock);
    }
    if (this._textBlock) {
      this._textBlock.dispose();
      this._textBlock = null;
    }
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────

function resolveShape(
  shape: MarkShape | null | undefined,
  atomRadius: number,
): ResolvedShape | null {
  if (shape === null) return null;
  const autoRadius = atomRadius * HALO_TO_ATOM_RATIO;
  if (shape === undefined) {
    return {
      kind: "sphere",
      color: DEFAULT_SHAPE_COLOR,
      opacity: DEFAULT_SHAPE_OPACITY,
      radius: autoRadius,
      segments: DEFAULT_SHAPE_SEGMENTS,
    };
  }
  return {
    kind: shape.kind ?? "sphere",
    color: shape.color ?? DEFAULT_SHAPE_COLOR,
    opacity: shape.opacity ?? DEFAULT_SHAPE_OPACITY,
    radius: shape.radius ?? autoRadius,
    segments: shape.segments ?? DEFAULT_SHAPE_SEGMENTS,
  };
}

function resolveLabel(
  label: MarkLabel | null | undefined,
): ResolvedLabel | null {
  if (label == null) return null;
  // Font size here is only a seed; when fontSize was not provided the
  // MarkAtomOverlay projects per-frame and overwrites this. The seed just
  // keeps the control from initializing at an ugly size before the first
  // render tick.
  return {
    text: label.text,
    color: label.color ?? DEFAULT_LABEL_COLOR,
    fontSize: label.fontSize ?? LABEL_FONT_MIN,
    background: label.background ?? null,
    offset: label.offset ?? [0, 0, 0],
  };
}

function resolveDefaults(p: MarkAtomProps, atomRadius: number): ResolvedProps {
  return {
    anchorAtomId: p.anchorAtomId,
    shape: resolveShape(p.shape, atomRadius),
    label: resolveLabel(p.label),
    name: p.name ?? "",
  };
}

export type { MarkAtomProps };
