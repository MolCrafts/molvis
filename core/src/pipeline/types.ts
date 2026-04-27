import type { Frame } from "@molcrafts/molrs";

/**
 * Selection mask representing a subset of atoms/bonds.
 * Implemented as a boolean array where true = selected.
 */
export class SelectionMask {
  private mask: boolean[];

  constructor(size: number, initialValue = false) {
    this.mask = new Array(size).fill(initialValue);
  }

  /**
   * Create a mask with all atoms selected.
   */
  static all(size: number): SelectionMask {
    return new SelectionMask(size, true);
  }

  /**
   * Create a mask with no atoms selected.
   */
  static none(size: number): SelectionMask {
    return new SelectionMask(size, false);
  }

  /**
   * Create a mask from an array of indices.
   */
  static fromIndices(size: number, indices: number[]): SelectionMask {
    const mask = new SelectionMask(size, false);
    for (const idx of indices) {
      if (idx >= 0 && idx < size) {
        mask.mask[idx] = true;
      }
    }
    return mask;
  }

  /**
   * Get the size of the mask.
   */
  get size(): number {
    return this.mask.length;
  }

  /**
   * Check if an index is selected.
   */
  isSelected(index: number): boolean {
    return this.mask[index] ?? false;
  }

  /**
   * Return a new mask with the given index set to the specified state.
   */
  withSelected(index: number, selected: boolean): SelectionMask {
    const result = this.clone();
    if (index >= 0 && index < result.mask.length) {
      result.mask[index] = selected;
    }
    return result;
  }

  /**
   * Get count of selected atoms.
   */
  count(): number {
    return this.mask.filter(Boolean).length;
  }

  /**
   * Get array of selected indices.
   */
  getIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i]) {
        indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Clone this mask.
   */
  clone(): SelectionMask {
    const cloned = new SelectionMask(this.mask.length);
    cloned.mask = [...this.mask];
    return cloned;
  }

  /**
   * Union with another mask (OR operation).
   */
  union(other: SelectionMask): SelectionMask {
    const size = Math.max(this.size, other.size);
    const result = new SelectionMask(size);
    for (let i = 0; i < size; i++) {
      result.mask[i] = this.isSelected(i) || other.isSelected(i);
    }
    return result;
  }

  /**
   * Intersection with another mask (AND operation).
   */
  intersection(other: SelectionMask): SelectionMask {
    const size = Math.min(this.size, other.size);
    const result = new SelectionMask(size);
    for (let i = 0; i < size; i++) {
      result.mask[i] = this.isSelected(i) && other.isSelected(i);
    }
    return result;
  }

  /**
   * Invert the mask (NOT operation).
   */
  invert(): SelectionMask {
    const result = new SelectionMask(this.size);
    for (let i = 0; i < this.size; i++) {
      result.mask[i] = !this.mask[i];
    }
    return result;
  }

  /**
   * Check if all atoms are selected.
   */
  isAll(): boolean {
    return this.mask.every(Boolean);
  }

  /**
   * Check if no atoms are selected.
   */
  isEmpty(): boolean {
    return this.mask.every((v) => !v);
  }
}

import type { MolvisApp } from "../app";

/**
 * What kind of frame change triggered this pipeline run. Threaded into
 * {@link PipelineContext} so draw modifiers can pick a fast path
 * (position-only buffer update) vs. full rebuild.
 *
 * - `"position"`: same topology, only coordinates moved (trajectory step).
 *   Draw modifiers patch GPU buffers in place.
 * - `"full"`: anything else (first load, topology change, modifier toggle,
 *   pipeline edit) → full rebuild of meshes and buffers.
 */
export type FrameChangeKind = "position" | "full";

/**
 * Pipeline execution context that flows through modifiers.
 */
export interface PipelineContext {
  /**
   * Named selections available for reference.
   */
  selectionSet: Map<string, SelectionMask>;

  /**
   * The current active selection used implicitly by selection-sensitive modifiers.
   */
  currentSelection: SelectionMask;

  /**
   * Logical bond IDs selected by the current pipeline run.
   * Set by selection modifiers that carry bond info (e.g., SelectModifier).
   * Read by the COMPUTED sync handler to update SelectionManager.
   */
  selectedBondIds: number[];

  /**
   * When true, the pipeline selection should not trigger visual highlighting.
   * Set by SelectModifier when its highlight property is false.
   */
  suppressHighlight: boolean;

  /**
   * Callbacks to run AFTER rendering + highlighting.
   * Modifiers push GPU buffer patches here during apply().
   */
  postRenderEffects: Array<() => void>;

  /**
   * Cache of selection masks keyed by modifier ID.
   * Selection-producing modifiers store their output here so that
   * child modifiers can look up the parent selection by ID.
   */
  selectionCache: Map<string, SelectionMask>;

  /**
   * Frame index in trajectory (if applicable).
   */
  frameIndex?: number;

  /**
   * Application instance for modifiers to trigger refreshes.
   */
  readonly app: MolvisApp;

  /**
   * What kind of frame change triggered this pipeline run.
   * Draw modifiers consult this to pick a fast path vs. full rebuild.
   */
  readonly changeKind: FrameChangeKind;
}

/**
 * Create a default pipeline context for a frame.
 */
export function createDefaultContext(
  frame: Frame,
  app: MolvisApp,
  frameIndex?: number,
  changeKind: FrameChangeKind = "full",
): PipelineContext {
  const atomsBlock = frame.getBlock("atoms");
  const atomCount = atomsBlock?.nrows() ?? 0;
  return {
    selectionSet: new Map(),
    currentSelection: SelectionMask.all(atomCount),
    selectedBondIds: [],
    suppressHighlight: false,
    postRenderEffects: [],
    selectionCache: new Map(),
    frameIndex,
    app,
    changeKind,
  };
}

/**
 * Push a new selection scope (for WithSelection blocks).
 */
export function pushSelectionScope(
  context: PipelineContext,
  newSelection: SelectionMask,
): PipelineContext {
  return {
    ...context,
    currentSelection: newSelection,
  };
}

/**
 * Validation result from modifier.validate().
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}
