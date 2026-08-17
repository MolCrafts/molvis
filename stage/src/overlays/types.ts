/**
 * Core types for the Overlay system.
 *
 * Overlays are independent visual decorations rendered directly via BabylonJS.
 * They live outside the modifier pipeline and ImpostorState buffers, and are
 * managed by OverlayManager on MolvisApp.
 */

export type Vec3 = [number, number, number];

/**
 * Base interface for all overlay types.
 */
export interface Overlay {
  readonly id: string;
  readonly type: string;
  visible: boolean;
  /** Release BabylonJS resources held by this overlay. */
  dispose(): void;
  /**
   * Called once per render frame to sync screen-space positions.
   * Only implement for overlays that need per-frame projection (text labels,
   * world-anchored 2D elements). Omit for pure 3D world-space overlays.
   */
  updateScreenPositions?(): void;
}

/**
 * Optional protocol for overlays that follow an atom across frame updates.
 *
 * Implemented by TextLabelOverlay, MarkAtomOverlay, etc. The core
 * dispatch loop (app.ts) duck-types on these two members — overlays that
 * do not need atom tracking simply omit them.
 */
export interface AtomAnchored {
  /** Atom index to follow. Return a negative value to disable anchoring. */
  getAnchorAtomId(): number;
  /** Called once per frame-rendered with the anchored atom's position. */
  syncToAtomPosition(x: number, y: number, z: number): void;
}

/** Event map for OverlayManager. */
export interface OverlayEventMap {
  "overlay-added": { overlay: Overlay };
  "overlay-removed": { id: string };
  "overlay-changed": { overlay: Overlay };
}

// ── Arrow3D ──────────────────────────────────────────────────────────────────

export interface Arrow3DProps {
  /** World-space start position. */
  from: Vec3;
  /** World-space end position. */
  to: Vec3;
  /** CSS hex color string. Default: "#ff4444". */
  color?: string;
  /** Opacity 0–1. Default: 1. */
  opacity?: number;
  /** Shaft radius in world units. Default: 0.05. */
  shaftRadius?: number;
  /** Fraction of total length used for the arrowhead. Default: 0.25. */
  headRatio?: number;
  /** Cone base radius. Default: shaftRadius × 3. */
  headRadius?: number;
  /** Optional display name. */
  name?: string;
}

// ── Arrow2D ───────────────────────────────────────────────────────────────────

export interface Arrow2DProps {
  /** World-space start position. */
  from: Vec3;
  /** World-space end position. */
  to: Vec3;
  /** CSS hex color string. Default: "#44aaff". */
  color?: string;
  /** Line width in world units. Default: 0.03. */
  strokeWidth?: number;
  /** Arrowhead size factor relative to strokeWidth. Default: 4. */
  headSize?: number;
  /** Render as dashed line. Default: false. */
  dashed?: boolean;
  /**
   * Billboard mode — arrow always faces the camera.
   * Useful for 2D-style diagram annotations. Default: false.
   */
  billboard?: boolean;
  /** Optional display name. */
  name?: string;
}

// ── TextLabel ─────────────────────────────────────────────────────────────────

export interface TextLabelProps {
  /** World-space anchor position. */
  position: Vec3;
  /** Label text content. */
  text: string;
  /** CSS color. Default: "white". */
  color?: string;
  /** Font size in pixels. Default: 14. */
  fontSize?: number;
  /** Background color, or null for transparent. Default: null. */
  background?: string | null;
  /**
   * Always face camera (billboard). Default: true.
   */
  billboard?: boolean;
  /**
   * Atom ID to pin this label to. The label will follow the atom position
   * across frame updates via the "frame-rendered" event.
   */
  anchorAtomId?: number;
  /** Offset from anchor position in world units. Default: [0, 0, 0]. */
  offset?: Vec3;
  /** Optional display name. */
  name?: string;
}

// ── MarkAtom ──────────────────────────────────────────────────────────────────

/**
 * Visual shape component of a MarkAtom overlay.
 *
 * `kind` is reserved as an extension point — currently only `"sphere"`
 * (translucent halo) is implemented; future kinds (ring, cube, crosshair)
 * can be added without breaking the API.
 */
export interface MarkShape {
  /** Shape kind. Default: "sphere". */
  kind?: "sphere";
  /** CSS hex color string. Default: "#ffd54a" (amber). */
  color?: string;
  /** Opacity 0–1. Default: 0.35. */
  opacity?: number;
  /**
   * World-space radius in Å. When omitted, auto-sized to 1.5× the marked
   * atom's rendered radius so the halo always rings the atom regardless of
   * element or representation.
   */
  radius?: number;
  /** Sphere tessellation segments. Default: 24. */
  segments?: number;
}

/**
 * Text label component of a MarkAtom overlay.
 *
 * Projected onto a BabylonJS GUI AdvancedDynamicTexture each frame, so the
 * label always faces the camera and stays crisp at any zoom level.
 */
export interface MarkLabel {
  /** Label text content (required when label is enabled). */
  text: string;
  /** CSS color. Default: "white". */
  color?: string;
  /**
   * Font size in pixels. When omitted, the label size tracks the marked
   * atom's on-screen pixel radius each frame, so text stays legibly
   * proportional as the user zooms.
   */
  fontSize?: number;
  /** Background color, or null for transparent. Default: null. */
  background?: string | null;
  /** World-space offset from the mark center. Default: [0, 0, 0]. */
  offset?: Vec3;
}

/**
 * MarkAtom — a composite overlay that marks a specific atom with an optional
 * shape (translucent halo) and/or an optional text label.
 *
 * Intended for annotating endpoints in pSMILES / bigSMILES, tagging reactive
 * sites, or flagging atoms of interest from external analyses. One MarkAtom
 * represents one marked atom, carries a single id, and can be undone as a
 * unit — no need to keep a shape-overlay + label-overlay pair in sync.
 *
 * Identity is **always** by atom id (`anchorAtomId`) — never by world
 * coordinates. A mark pinned to a coordinate would float in space when the
 * trajectory advances or the molecule is re-aligned, defeating the purpose of
 * marking *an atom*. Coordinate-anchored decoration is a different concept;
 * use `text_label` (via `add_overlay`) for that.
 *
 * Because the mark follows the atom, the halo radius and label font size are
 * auto-sized from the marked atom's rendered size, so they stay visually
 * proportional across zoom and representation changes.
 *
 * `shape` and `label` are independently optional. Pass `null` to omit a
 * component; omit the field entirely to accept the default (shape enabled
 * with sphere defaults, label disabled).
 */
export interface MarkAtomProps {
  /**
   * Atom index to mark. Must be a non-negative integer. The mark follows
   * this atom across frame updates.
   */
  anchorAtomId: number;
  /** Shape component. Pass null to show no shape. Default: { kind: "sphere" }. */
  shape?: MarkShape | null;
  /** Label component. Pass null or omit to show no label. Default: null. */
  label?: MarkLabel | null;
  /** Optional display name. */
  name?: string;
}

// ── VectorField ───────────────────────────────────────────────────────────────

export interface VectorFieldProps {
  /** Flat Nx3 array of arrow origin positions (world space). */
  positions: Float32Array;
  /** Flat Nx3 array of direction+magnitude vectors. */
  vectors: Float32Array;
  /** Length scale multiplier. Default: 1. */
  scale?: number;
  /** Color mode for arrows. Default: "magnitude". */
  colorMode?: "uniform" | "magnitude" | "direction";
  /** CSS hex color used in "uniform" mode. Default: "#4488ff". */
  color?: string;
  /** Maximum arrows rendered (excess culled). Default: 5000. */
  maxArrows?: number;
  /** Shaft radius. Default: 0.03. */
  shaftRadius?: number;
  /** Fraction of arrow length used for the cone. Default: 0.25. */
  headRatio?: number;
  /** Optional display name. */
  name?: string;
}
