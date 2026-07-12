import { EventEmitter } from "./events";
import type { SceneIndex } from "./scene_index";
import { ExpressionSelector } from "./selection/expression";

export type SelectionKey = string;

export interface SelectionRef {
  meshId: number;
  subIndex?: number;
}

export function makeSelectionKey(
  meshId: number,
  subIndex?: number,
): SelectionKey {
  return subIndex === undefined ? String(meshId) : `${meshId}:${subIndex}`;
}

export function parseSelectionKey(key: SelectionKey): SelectionRef | null {
  const [meshPart, subPart] = key.split(":");
  if (!meshPart) return null;

  const meshId = Number(meshPart);
  if (!Number.isFinite(meshId)) return null;

  if (subPart === undefined || subPart === "") {
    return { meshId };
  }

  const subIndex = Number(subPart);
  if (!Number.isFinite(subIndex)) {
    return { meshId };
  }

  return { meshId, subIndex };
}

// ============ Types (Colocated) ============

/**
 * Selection state using logical atom and bond ids.
 */
export interface SelectionState {
  atoms: Set<number>;
  bonds: Set<number>;
  revision: number;
}

export interface SelectedEntity {
  type: "atom" | "bond";
  meshId: number;
  instanceIndex: number;
}

/**
 * Response structure for get_selected command.
 * Format is compatible with molpy.Frame construction.
 */
export interface GetSelectedResponse {
  atoms: {
    atomId: number[];
    element: string[];
    x: number[];
    y: number[];
    z: number[];
  };
  bonds: {
    bondId: number[];
    atomId1: number[];
    atomId2: number[];
    order: number[];
    start_x: number[];
    start_y: number[];
    start_z: number[];
    end_x: number[];
    end_y: number[];
    end_z: number[];
  };
}

/**
 * Selection operations.
 */
export type SelectionOp =
  | {
      type: "replace";
      atoms?: Iterable<number | SelectionKey>;
      bonds?: Iterable<number | SelectionKey>;
    }
  | {
      type: "add";
      atoms?: Iterable<number | SelectionKey>;
      bonds?: Iterable<number | SelectionKey>;
    }
  | {
      type: "remove";
      atoms?: Iterable<number | SelectionKey>;
      bonds?: Iterable<number | SelectionKey>;
    }
  | {
      type: "toggle";
      atoms?: Iterable<number | SelectionKey>;
      bonds?: Iterable<number | SelectionKey>;
    }
  | { type: "clear" };

export type SelectionSource = "manual" | "expression";

export interface SelectionApplyMeta {
  source?: SelectionSource;
  expression?: string;
}

// ============ SelectionManager ============

interface SelectionEventMap {
  "selection-change": SelectionState;
}

/**
 * SelectionManager: maintains selection state and emits change events.
 */
export class SelectionManager extends EventEmitter<SelectionEventMap> {
  private state: SelectionState = {
    atoms: new Set(),
    bonds: new Set(),
    revision: 0,
  };
  private sceneIndex: SceneIndex;
  private source: SelectionSource = "manual";
  private lastExpression: string | null = null;

  constructor(sceneIndex: SceneIndex) {
    super();
    this.sceneIndex = sceneIndex;
  }

  /**
   * Apply a selection operation.
   *
   * @param op - The selection operation to apply
   */
  apply(op: SelectionOp, meta?: SelectionApplyMeta): void {
    switch (op.type) {
      case "replace":
        this.state.atoms = new Set(this.resolveAtomIds(op.atoms));
        this.state.bonds = new Set(this.resolveBondIds(op.bonds));
        break;

      case "add":
        if (op.atoms) {
          for (const id of this.resolveAtomIds(op.atoms)) {
            this.state.atoms.add(id);
          }
        }
        if (op.bonds) {
          for (const id of this.resolveBondIds(op.bonds)) {
            this.state.bonds.add(id);
          }
        }
        break;

      case "remove":
        if (op.atoms) {
          for (const id of this.resolveAtomIds(op.atoms)) {
            this.state.atoms.delete(id);
          }
        }
        if (op.bonds) {
          for (const id of this.resolveBondIds(op.bonds)) {
            this.state.bonds.delete(id);
          }
        }
        break;

      case "toggle":
        if (op.atoms) {
          for (const id of this.resolveAtomIds(op.atoms)) {
            if (this.state.atoms.has(id)) {
              this.state.atoms.delete(id);
            } else {
              this.state.atoms.add(id);
            }
          }
        }
        if (op.bonds) {
          for (const id of this.resolveBondIds(op.bonds)) {
            if (this.state.bonds.has(id)) {
              this.state.bonds.delete(id);
            } else {
              this.state.bonds.add(id);
            }
          }
        }
        break;

      case "clear":
        this.state.atoms.clear();
        this.state.bonds.clear();
        break;
    }

    if (meta?.source) {
      this.source = meta.source;
      if (meta.source === "expression" && meta.expression) {
        this.lastExpression = meta.expression;
      }
    } else if (op.type === "clear") {
      this.source = "manual";
    } else {
      this.source = "manual";
    }

    this.emitChange();
  }

  /**
   * Check if a selection key is selected.
   *
   * @param key - The selection key
   * @returns true if selected, false otherwise
   */
  isSelected(key: SelectionKey | number, type?: "atom" | "bond"): boolean {
    if (typeof key === "number") {
      return type === "bond"
        ? this.state.bonds.has(key)
        : this.state.atoms.has(key);
    }
    const meta = this.metaForKey(key);
    if (meta?.type === "atom") return this.state.atoms.has(meta.atomId);
    if (meta?.type === "bond") return this.state.bonds.has(meta.bondId);
    return false;
  }

  /**
   * Get the current selection state.
   *
   * @returns The current selection state
   */
  getState(): SelectionState {
    return {
      atoms: new Set(this.state.atoms),
      bonds: new Set(this.state.bonds),
      revision: this.state.revision,
    };
  }

  /**
   * Clear the current selection.
   */
  clearSelection(): void {
    this.apply({ type: "clear" });
  }

  /**
   * Select atoms by their logical atom IDs.
   */
  selectAtomsByIds(ids: number[]): void {
    this.apply({ type: "add", atoms: ids });
  }

  /**
   * Replace selected atoms by logical IDs.
   * Bond selection is cleared.
   */
  replaceAtomsByIds(ids: Iterable<number>): void {
    this.apply({ type: "replace", atoms: ids });
  }

  /**
   * Select atoms using a boolean expression.
   *
   * @param expression - The boolean expression (e.g. "element == 'C'")
   * @param op - The selection operation (default: "replace")
   */
  selectByExpression(
    expression: string,
    op: "replace" | "add" | "remove" | "toggle" = "replace",
  ): void {
    const atomIds = ExpressionSelector.select(this.sceneIndex, expression);
    this.apply(
      { type: op, atoms: atomIds },
      { source: "expression", expression },
    );
  }

  /**
   * Returns true when the active selection originated from expression selection.
   */
  hasExpressionSelectionContext(): boolean {
    return this.source === "expression" && this.lastExpression !== null;
  }

  /**
   * Reapply the latest expression using "replace" semantics.
   * Returns false if no expression is available or evaluation fails.
   */
  reapplyLastExpression(): boolean {
    if (!this.lastExpression) return false;
    try {
      this.selectByExpression(this.lastExpression, "replace");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get IDs of all selected atoms.
   */
  getSelectedAtomIds(): Set<number> {
    return new Set(this.state.atoms);
  }

  /**
   * Get metadata for all selected entities.
   * Returns data in molpy.Frame compatible format.
   *
   * @returns Object with columnar arrays of atom and bond metadata
   */
  getSelectedMeta(): GetSelectedResponse {
    const atomIds: number[] = [];
    const elements: string[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];

    const bondIds: number[] = [];
    const atomId1s: number[] = [];
    const atomId2s: number[] = [];
    const orders: number[] = [];
    const startXs: number[] = [];
    const startYs: number[] = [];
    const startZs: number[] = [];
    const endXs: number[] = [];
    const endYs: number[] = [];
    const endZs: number[] = [];

    // Collect atom metadata
    for (const atomId of this.state.atoms) {
      const key = this.sceneIndex.getSelectionKeyForAtom(atomId);
      const meta = key ? this.metaForKey(key) : null;
      if (meta?.type === "atom") {
        atomIds.push(meta.atomId);
        elements.push(meta.element);
        xs.push(meta.position.x);
        ys.push(meta.position.y);
        zs.push(meta.position.z);
      }
    }

    // Collect bond metadata
    for (const bondId of this.state.bonds) {
      const keys = this.sceneIndex.getSelectionKeysForBond(bondId);
      const meta = keys.length > 0 ? this.metaForKey(keys[0]) : null;
      if (meta?.type === "bond") {
        bondIds.push(meta.bondId);
        atomId1s.push(meta.atomId1);
        atomId2s.push(meta.atomId2);
        orders.push(meta.order);
        startXs.push(meta.start.x);
        startYs.push(meta.start.y);
        startZs.push(meta.start.z);
        endXs.push(meta.end.x);
        endYs.push(meta.end.y);
        endZs.push(meta.end.z);
      }
    }

    return {
      atoms: {
        atomId: atomIds,
        element: elements,
        x: xs,
        y: ys,
        z: zs,
      },
      bonds: {
        bondId: bondIds,
        atomId1: atomId1s,
        atomId2: atomId2s,
        order: orders,
        start_x: startXs,
        start_y: startYs,
        start_z: startZs,
        end_x: endXs,
        end_y: endYs,
        end_z: endZs,
      },
    };
  }

  private emitChange(): void {
    this.state.revision++;
    this.emit("selection-change", this.getState());
  }

  private metaForKey(
    key: SelectionKey,
  ): ReturnType<SceneIndex["getMeta"]> | null {
    const ref = parseSelectionKey(key);
    if (!ref) return null;
    return this.sceneIndex.getMeta(ref.meshId, ref.subIndex) ?? null;
  }

  private *resolveAtomIds(
    values: Iterable<number | SelectionKey> | undefined,
  ): IterableIterator<number> {
    if (!values) return;
    for (const value of values) {
      if (typeof value === "number") {
        yield value;
        continue;
      }
      const meta = this.metaForKey(value);
      if (meta?.type === "atom") yield meta.atomId;
    }
  }

  private *resolveBondIds(
    values: Iterable<number | SelectionKey> | undefined,
  ): IterableIterator<number> {
    if (!values) return;
    for (const value of values) {
      if (typeof value === "number") {
        yield value;
        continue;
      }
      const meta = this.metaForKey(value);
      if (meta?.type === "bond") yield meta.bondId;
    }
  }
}
