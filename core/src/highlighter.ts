import { Color3, Color4, type Mesh, type Scene } from "@babylonjs/core";
import type { MolvisApp } from "./app";
import { parseSelectionKey, type SelectionState } from "./selection_manager";

/**
 * Highlighter: Mode-aware highlighting in a single module.
 * All highlighting uses thin instance colorBuffer (impostor pipeline).
 *
 * Responsibilities:
 * - Apply highlights based on selection state
 * - Restore original colors on deselect
 * - Handle mode switches (invalidate and rebuild)
 */
export class Highlighter {
  private scene: Scene;

  // Sparse storage for thin instance original colors
  // Key: `${uniqueId}:${thinIndex}`
  private thinOriginalColors = new Map<
    string,
    Array<{ bufferName: string; r: number; g: number; b: number; a: number }>
  >();

  // State
  private lastSelectionState: SelectionState = {
    atoms: new Set(),
    bonds: new Set(),
    revision: 0,
  };
  private previewKeys: Set<string> = new Set();

  private app: MolvisApp;

  constructor(app: MolvisApp, scene: Scene) {
    this.app = app;
    this.scene = scene;
  }

  /**
   * Set the current selection state (redrawn immediately).
   */
  highlightSelection(state: SelectionState): void {
    const selectionColor = this.selectionColor();
    for (const atomId of this.lastSelectionState.atoms) {
      if (!state.atoms.has(atomId)) this.restoreAtom(atomId);
    }
    for (const bondId of this.lastSelectionState.bonds) {
      if (!state.bonds.has(bondId)) this.restoreBond(bondId);
    }
    for (const atomId of state.atoms) {
      if (!this.lastSelectionState.atoms.has(atomId)) {
        this.highlightAtom(atomId, selectionColor);
      }
    }
    for (const bondId of state.bonds) {
      if (!this.lastSelectionState.bonds.has(bondId)) {
        this.highlightBond(bondId, selectionColor);
      }
    }
    this.lastSelectionState = {
      atoms: new Set(state.atoms),
      bonds: new Set(state.bonds),
      revision: state.revision,
    };
  }

  /**
   * Set the current preview (hover) keys.
   */
  highlightPreview(keys: string[]): void {
    this.previewKeys.clear();
    for (const k of keys) {
      this.previewKeys.add(k);
    }
    this.render();
  }

  /**
   * Main render loop: Clears all, then applies Preview, then Selection (Selection overrides Preview).
   */
  private render(): void {
    this.clearAll();

    // 1. Apply Preview
    for (const key of this.previewKeys) {
      // If already selected, skip preview (Selection wins)
      if (this.isPreviewKeySelected(key)) {
        continue;
      }
      this.applyHighlight(key, [0.4, 0.8, 1.0, 0.8]); // Soft Cyan (with alpha)
    }

    // 2. Apply Selection
    const selectionColor = this.selectionColor();

    for (const atomId of this.lastSelectionState.atoms) {
      this.highlightAtom(atomId, selectionColor);
    }
    for (const bondId of this.lastSelectionState.bonds) {
      this.highlightBond(bondId, selectionColor);
    }
  }

  private selectionColor(): number[] {
    const selectionColorHex = this.app.styleManager.getTheme().selectionColor;
    if (selectionColorHex.length > 7) {
      const c4 = Color4.FromHexString(selectionColorHex);
      return [c4.r ** 2.2, c4.g ** 2.2, c4.b ** 2.2, 1.0];
    }
    const c3 = Color3.FromHexString(selectionColorHex).toLinearSpace();
    return [c3.r, c3.g, c3.b, 1.0];
  }

  private isPreviewKeySelected(key: string): boolean {
    const ref = parseSelectionKey(key);
    if (!ref) return false;
    const meta = this.app.world.sceneIndex.getMeta(ref.meshId, ref.subIndex);
    if (meta?.type === "atom")
      return this.lastSelectionState.atoms.has(meta.atomId);
    if (meta?.type === "bond")
      return this.lastSelectionState.bonds.has(meta.bondId);
    return false;
  }

  private highlightAtom(atomId: number, color: number[]): void {
    const key = this.app.world.sceneIndex.getSelectionKeyForAtom(atomId);
    if (key) this.applyHighlight(key, color);
  }

  private highlightBond(bondId: number, color: number[]): void {
    for (const key of this.app.world.sceneIndex.getSelectionKeysForBond(
      bondId,
    )) {
      this.applyHighlight(key, color);
    }
  }

  private restoreAtom(atomId: number): void {
    const key = this.app.world.sceneIndex.getSelectionKeyForAtom(atomId);
    if (key) this.restoreHighlight(key);
  }

  private restoreBond(bondId: number): void {
    for (const key of this.app.world.sceneIndex.getSelectionKeysForBond(
      bondId,
    )) {
      this.restoreHighlight(key);
    }
  }

  private applyHighlight(key: string, colorBufferVal: number[]): void {
    const ref = parseSelectionKey(key);
    if (!ref) return;

    const mesh = this.scene.getMeshByUniqueId(ref.meshId) as Mesh;
    if (!mesh) return;

    if (ref.subIndex !== undefined) {
      this.highlightThinInstance(mesh, ref.subIndex, colorBufferVal);
    }
  }

  private restoreHighlight(key: string): void {
    const colors = this.thinOriginalColors.get(key);
    if (!colors) return;
    const [uniqueIdStr, thinIndexStr] = key.split(":");
    const uniqueId = Number.parseInt(uniqueIdStr, 10);
    const thinIndex = Number.parseInt(thinIndexStr, 10);
    const mesh = this.scene.getMeshByUniqueId(uniqueId) as Mesh;
    if (!mesh) {
      this.thinOriginalColors.delete(key);
      return;
    }
    const buffers = new Map(
      this.getThinInstanceColorBuffers(mesh).map(({ name, data }) => [
        name,
        data,
      ]),
    );
    for (const color of colors) {
      const buffer = buffers.get(color.bufferName);
      if (!buffer) continue;
      const offset = thinIndex * 4;
      buffer[offset] = color.r;
      buffer[offset + 1] = color.g;
      buffer[offset + 2] = color.b;
      mesh.thinInstanceSetBuffer(color.bufferName, buffer, 4, false);
    }
    this.thinOriginalColors.delete(key);
  }

  /**
   * Highlight a thin instance.
   */
  private highlightThinInstance(
    mesh: Mesh,
    thinIndex: number,
    color: number[],
  ): void {
    const key = `${mesh.uniqueId}:${thinIndex}`;
    const colorBuffers = this.getThinInstanceColorBuffers(mesh);
    if (colorBuffers.length === 0) return;

    // Store original color (sparse) if not already stored
    if (!this.thinOriginalColors.has(key)) {
      this.thinOriginalColors.set(
        key,
        colorBuffers.map(({ name, data }) => {
          const offset = thinIndex * 4;
          return {
            bufferName: name,
            r: data[offset],
            g: data[offset + 1],
            b: data[offset + 2],
            a: data[offset + 3],
          };
        }),
      );
    }

    for (const { name, data } of colorBuffers) {
      const offset = thinIndex * 4;
      // Overwrite RGB but preserve the existing alpha so that pipeline-computed
      // transparency (e.g. TransparentSelectionModifier) is not destroyed.
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      // Keep data[offset + 3] unchanged
      mesh.thinInstanceSetBuffer(name, data, 4, false);
    }
  }

  /**
   * Clear all highlights and restore original colors.
   */
  clearAll(): void {
    // Restore thin instance colors
    for (const [key, colors] of this.thinOriginalColors) {
      const [uniqueIdStr, thinIndexStr] = key.split(":");
      const uniqueId = Number.parseInt(uniqueIdStr, 10);
      const thinIndex = Number.parseInt(thinIndexStr, 10);

      const mesh = this.scene.getMeshByUniqueId(uniqueId) as Mesh;
      if (!mesh) continue;

      const buffers = new Map(
        this.getThinInstanceColorBuffers(mesh).map(({ name, data }) => [
          name,
          data,
        ]),
      );
      for (const color of colors) {
        const buffer = buffers.get(color.bufferName);
        if (!buffer) continue;

        const offset = thinIndex * 4;
        buffer[offset] = color.r;
        buffer[offset + 1] = color.g;
        buffer[offset + 2] = color.b;
        // Do NOT restore alpha — it is managed by the pipeline
        // (TransparentSelectionModifier, SliceModifier, globalOpacity).

        mesh.thinInstanceSetBuffer(color.bufferName, buffer, 4, false);
      }
    }
    this.thinOriginalColors.clear();
  }

  /**
   * Discard saved originals without restoring them.
   * Use after a full scene rebuild when the old buffer data is stale.
   */
  discardSavedOriginals(): void {
    this.thinOriginalColors.clear();
  }

  /**
   * Invalidate and rebuild highlights (called on mode switch).
   */
  invalidateAndRebuild(): void {
    this.clearAll();
    this.render();
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.clearAll();
  }

  private getThinInstanceColorBuffers(
    mesh: Mesh,
  ): Array<{ name: string; data: Float32Array }> {
    const storage = (
      mesh as unknown as {
        _userThinInstanceBuffersStorage?: {
          data?: Record<string, Float32Array>;
        };
      }
    )._userThinInstanceBuffersStorage;

    const buffers: Array<{ name: string; data: Float32Array }> = [];
    const single = storage?.data?.instanceColor;
    if (single instanceof Float32Array) {
      buffers.push({ name: "instanceColor", data: single });
    }
    const start = storage?.data?.instanceColor0;
    if (start instanceof Float32Array) {
      buffers.push({ name: "instanceColor0", data: start });
    }
    const end = storage?.data?.instanceColor1;
    if (end instanceof Float32Array) {
      buffers.push({ name: "instanceColor1", data: end });
    }
    return buffers;
  }
}
