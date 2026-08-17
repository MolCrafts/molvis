/**
 * TextLabelOverlay — a text annotation anchored to a world-space position.
 *
 * Uses BabylonJS AdvancedDynamicTexture (fullscreen GUI) with a TextBlock +
 * optional Rectangle background. The label projects from 3D world position
 * to screen coordinates each frame via updateScreenPositions().
 *
 * Supports optional atom anchoring: when `anchorAtomId` is set, the label
 * follows the atom position across frame updates automatically.
 */

import type { Scene } from "@babylonjs/core";
import { Matrix, Vector3 } from "@babylonjs/core";
import {
  type AdvancedDynamicTexture,
  Rectangle,
  TextBlock,
} from "@babylonjs/gui";
import type { AtomAnchored, Overlay, TextLabelProps } from "./types";

const DEFAULT_COLOR = "white";
const DEFAULT_FONT_SIZE = 14;

let _counter = 0;
function nextId(): string {
  return `label_${++_counter}`;
}

export class TextLabelOverlay implements Overlay, AtomAnchored {
  readonly id: string;
  readonly type = "text_label" as const;

  private _props: Required<TextLabelProps>;
  private _scene: Scene;

  /** Shared fullscreen UI texture (reused across all TextLabelOverlays via scene). */
  private _uiTexture: AdvancedDynamicTexture;

  private _container: Rectangle | null = null;
  private _textBlock: TextBlock | null = null;

  /** Current world position (updated when anchorAtomId syncs). */
  private _worldPos: Vector3;

  private _visible = true;

  private constructor(
    id: string,
    props: Required<TextLabelProps>,
    scene: Scene,
    uiTexture: AdvancedDynamicTexture,
  ) {
    this.id = id;
    this._props = props;
    this._scene = scene;
    this._uiTexture = uiTexture;
    this._worldPos = this._computeWorldPos();
    this._buildControls();
  }

  /**
   * Create a TextLabelOverlay.
   * Pass a shared AdvancedDynamicTexture so all labels share one fullscreen layer.
   */
  static create(
    scene: Scene,
    props: TextLabelProps,
    uiTexture: AdvancedDynamicTexture,
  ): TextLabelOverlay {
    return new TextLabelOverlay(
      nextId(),
      resolveDefaults(props),
      scene,
      uiTexture,
    );
  }

  get props(): Readonly<Required<TextLabelProps>> {
    return this._props;
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(v: boolean) {
    this._visible = v;
    if (this._container) this._container.isVisible = v;
    if (this._textBlock) this._textBlock.isVisible = v;
  }

  getAnchorAtomId(): number {
    return this._props.anchorAtomId;
  }

  /**
   * Update position from atom data (called when frame-rendered fires).
   * Only takes effect when anchorAtomId is set.
   */
  syncToAtomPosition(x: number, y: number, z: number): void {
    const { offset } = this._props;
    this._worldPos.set(x + offset[0], y + offset[1], z + offset[2]);
  }

  update(patch: Partial<TextLabelProps>): this {
    this._props = resolveDefaults({ ...this._props, ...patch });
    this._worldPos = this._computeWorldPos();
    this._disposeControls();
    this._buildControls();
    return this;
  }

  dispose(): void {
    this._disposeControls();
  }

  /**
   * Called each render frame by OverlayManager.updateScreenPositions().
   * Projects world → screen and repositions the GUI control.
   */
  updateScreenPositions(): void {
    if (!this._visible) return;
    if (!this._container && !this._textBlock) return;

    const camera = this._scene.activeCamera;
    if (!camera) return;

    const engine = this._scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = this._scene.getTransformMatrix();

    // `_worldPos` is already in world space, so the world matrix MUST be
    // identity; passing `transformMatrix` here would apply view*projection
    // twice. See memory/project_babylon_project_api.md.
    const projected = Vector3.Project(
      this._worldPos,
      Matrix.IdentityReadOnly,
      transformMatrix,
      viewportMatrix,
    );

    const control = this._container ?? this._textBlock;
    if (control) {
      // Guard against non-finite projection — see
      // memory/project_babylon_project_api.md.
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
        control.isVisible = false;
        return;
      }
      control.isVisible = true;
      control.left = `${projected.x - width / 2}px`;
      control.top = `${projected.y - height / 2}px`;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _computeWorldPos(): Vector3 {
    const { position, offset } = this._props;
    return new Vector3(
      position[0] + offset[0],
      position[1] + offset[1],
      position[2] + offset[2],
    );
  }

  private _buildControls(): void {
    const { text, color, fontSize, background } = this._props;

    const tb = new TextBlock(`${this.id}_tb`, text);
    tb.color = color;
    tb.fontSize = fontSize;
    tb.outlineWidth = 2;
    tb.outlineColor = "#000000";
    tb.isHitTestVisible = false;
    tb.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
    tb.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
    // Size TextBlock to its text content, otherwise it fills its parent
    // (the Rectangle w/ adaptWidthToChildren, or the fullscreen UI).
    tb.resizeToFit = true;

    if (background) {
      const rect = new Rectangle(`${this.id}_bg`);
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

    if (!this._visible) {
      if (this._container) this._container.isVisible = false;
      if (this._textBlock) this._textBlock.isVisible = false;
    }
  }

  private _disposeControls(): void {
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

function resolveDefaults(p: TextLabelProps): Required<TextLabelProps> {
  return {
    position: p.position,
    text: p.text,
    color: p.color ?? DEFAULT_COLOR,
    fontSize: p.fontSize ?? DEFAULT_FONT_SIZE,
    background: p.background ?? null,
    billboard: p.billboard ?? true,
    anchorAtomId: p.anchorAtomId ?? -1,
    offset: p.offset ?? [0, 0, 0],
    name: p.name ?? "",
  };
}
