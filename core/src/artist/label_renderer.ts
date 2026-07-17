/**
 * LabelRenderer — displays per-atom text labels in the 3D viewport.
 *
 * Uses BabylonJS AdvancedDynamicTexture (fullscreen UI) with TextBlock
 * controls positioned via manual 3D→screen projection each frame.
 */

import { Matrix, type Scene, Vector3 } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

export type LabelMode = "none" | "all" | "selected";

export interface LabelConfig {
  mode: LabelMode;
  /** Template string: "{element}", "{atomId}", or a column name */
  template: string;
  fontSize: number;
  color: string;
  /** Max visible labels to prevent performance issues */
  maxVisible: number;
}

export const DEFAULT_LABEL_CONFIG: Readonly<LabelConfig> = {
  mode: "none",
  template: "{element}",
  fontSize: 12,
  color: "#FFFFFF",
  maxVisible: 200,
};

interface LabelEntry {
  textBlock: TextBlock;
  atomIndex: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

/**
 * Resolve a label template against atom data.
 *
 * Supports:
 * - "{element}" → element string
 * - "{atomId}" or "{index}" → atom index
 * - "{columnName}" → value from columns map
 * - Plain text → literal
 */
export function resolveTemplate(
  template: string,
  index: number,
  element: string,
  columns: Map<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === "element") return element;
    if (key === "atomId" || key === "index") return String(index);
    return columns.get(key) ?? key;
  });
}

export class LabelRenderer {
  private scene: Scene;
  private uiTexture: AdvancedDynamicTexture | null = null;
  private labels: LabelEntry[] = [];
  private _config: LabelConfig = { ...DEFAULT_LABEL_CONFIG };
  private readonly beforeRender = () => this.updateScreenPositions();

  constructor(scene: Scene) {
    this.scene = scene;
    this.scene.onBeforeRenderObservable.add(this.beforeRender);
  }

  get config(): Readonly<LabelConfig> {
    return this._config;
  }

  setConfig(config: Partial<LabelConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Build labels from atom frame data.
   *
   * @param atoms - Object with atom data columns
   * @param selectedIndices - Set of selected atom indices (for "selected" mode)
   */
  build(
    atoms: {
      count: number;
      x: ArrayLike<number>;
      y: ArrayLike<number>;
      z: ArrayLike<number>;
      elements: string[];
      columns?: Map<string, string[]>;
      /** Optional sparse atom list, used by skeletal representations. */
      indices?: number[];
      /** Optional per-atom CSS colors. */
      colors?: string[];
      outlineColor?: string;
      outlineWidth?: number;
    },
    selectedIndices?: Set<number>,
  ): void {
    this.clearLabels();

    if (this._config.mode === "none") return;
    if (atoms.count === 0) return;

    if (!this.uiTexture) {
      this.uiTexture = AdvancedDynamicTexture.CreateFullscreenUI(
        "__molvis_labels__",
        true,
        this.scene,
      );
    }

    const indices = atoms.indices
      ? atoms.indices.slice(0, this._config.maxVisible)
      : this.resolveVisibleIndices(atoms.count, selectedIndices);

    for (const i of indices) {
      const columnValues = new Map<string, string>();
      if (atoms.columns) {
        for (const [colName, colData] of atoms.columns) {
          if (i < colData.length) {
            columnValues.set(colName, colData[i]);
          }
        }
      }

      const text = resolveTemplate(
        this._config.template,
        i,
        atoms.elements[i] ?? "?",
        columnValues,
      );

      const tb = new TextBlock(`label_${i}`, text);
      tb.color = atoms.colors?.[i] ?? this._config.color;
      tb.fontSize = this._config.fontSize;
      tb.outlineWidth = atoms.outlineWidth ?? 2;
      tb.outlineColor = atoms.outlineColor ?? "#000000";
      tb.isHitTestVisible = false;

      this.uiTexture.addControl(tb);

      this.labels.push({
        textBlock: tb,
        atomIndex: i,
        worldX: atoms.x[i],
        worldY: atoms.y[i],
        worldZ: atoms.z[i],
      });
    }

    this.updateScreenPositions();
  }

  /**
   * Update label screen positions from current camera.
   * Call this on frame-rendered events.
   */
  updateScreenPositions(): void {
    if (this.labels.length === 0) return;

    const camera = this.scene.activeCamera;
    if (!camera) return;

    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = this.scene.getTransformMatrix();

    const tmpVec = new Vector3();

    for (const label of this.labels) {
      tmpVec.set(label.worldX, label.worldY, label.worldZ);
      // Atom coordinates are already in world space; world matrix MUST be
      // identity. Passing `transformMatrix` twice applies view*projection
      // twice. See memory/project_babylon_project_api.md.
      const projected = Vector3.Project(
        tmpVec,
        Matrix.IdentityReadOnly,
        transformMatrix,
        viewportMatrix,
      );

      // Guard against non-finite projection.
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
        label.textBlock.isVisible = false;
        continue;
      }
      label.textBlock.isVisible = true;
      label.textBlock.left = `${projected.x - width / 2}px`;
      label.textBlock.top = `${projected.y - height / 2}px`;
    }
  }

  /**
   * Update world positions (e.g., after frame change) without rebuilding labels.
   */
  updatePositions(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>,
  ): void {
    for (const label of this.labels) {
      const i = label.atomIndex;
      if (i >= x.length) continue;
      label.worldX = x[i];
      label.worldY = y[i];
      label.worldZ = z[i];
    }
    this.updateScreenPositions();
  }

  clearLabels(): void {
    for (const label of this.labels) {
      label.textBlock.dispose();
    }
    this.labels = [];
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.beforeRender);
    this.clearLabels();
    if (this.uiTexture) {
      this.uiTexture.dispose();
      this.uiTexture = null;
    }
  }

  private resolveVisibleIndices(
    atomCount: number,
    selectedIndices?: Set<number>,
  ): number[] {
    const max = this._config.maxVisible;

    if (this._config.mode === "selected" && selectedIndices) {
      const indices = Array.from(selectedIndices);
      return indices.length > max ? indices.slice(0, max) : indices;
    }

    // "all" mode — cap at maxVisible
    const count = Math.min(atomCount, max);
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      indices.push(i);
    }
    return indices;
  }
}
