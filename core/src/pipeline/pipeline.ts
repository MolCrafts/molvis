import type { Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import { EventEmitter } from "../events";
import { logger } from "../utils/logger";
import { type Modifier, ModifierCapability } from "./modifier";
import {
  generateNatoId,
  isSelectionProducer,
  isTopologyChanging,
} from "./nato_ids";
import {
  type FrameChangeKind,
  type PipelineContext,
  SelectionMask,
  createDefaultContext,
} from "./types";

/**
 * Frame source interface for loading frames.
 */
export interface FrameSource {
  getFrame(index: number): Promise<Frame> | Frame;
  getFrameCount(): number | null;
}

export interface PipelineEventMap {
  "modifier-added": { modifier: Modifier; index: number };
  "modifier-removed": { modifier: Modifier; index: number };
  "modifier-reordered": {
    modifier: Modifier;
    oldIndex: number;
    newIndex: number;
  };
  "modifier-reparented": {
    modifierId: string;
    oldParentId: string | null;
    newParentId: string | null;
  };
  "pipeline-cleared": Record<string, never>;
  computed: { frame: Frame; context: PipelineContext };
}

export const PipelineEvents = {
  MODIFIER_ADDED: "modifier-added" as const,
  MODIFIER_REMOVED: "modifier-removed" as const,
  MODIFIER_REORDERED: "modifier-reordered" as const,
  MODIFIER_REPARENTED: "modifier-reparented" as const,
  PIPELINE_CLEARED: "pipeline-cleared" as const,
  COMPUTED: "computed" as const,
};

/**
 * Modifier pipeline that executes a sequence of modifiers.
 * Modifiers are stateless - all state is in the context and frame.
 */
export class ModifierPipeline extends EventEmitter<PipelineEventMap> {
  private modifiers: Modifier[] = [];

  /**
   * Add a modifier to the end of the pipeline.
   */
  addModifier(modifier: Modifier): void {
    // Auto-assign NATO ID — the pipeline owns IDs, not the caller
    const usedIds = new Set(this.modifiers.map((m) => m.id));
    (modifier as { id: string }).id = generateNatoId(usedIds);

    this.modifiers.push(modifier);
    this.emit(PipelineEvents.MODIFIER_ADDED, {
      modifier,
      index: this.modifiers.length - 1,
    });
  }

  /**
   * Remove a modifier from the pipeline.
   * Cascade-removes all children (recursively) before removing the target.
   * Returns the full list of removed modifiers (children first, then target).
   * Returns an empty array if the modifier was not found.
   */
  removeModifier(modifierId: string): Modifier[] {
    const target = this.modifiers.find((m) => m.id === modifierId);
    if (!target) {
      return [];
    }

    // Collect all descendants recursively
    const toRemove = this.collectDescendants(modifierId);
    toRemove.push(target);

    const removed: Modifier[] = [];
    for (const mod of toRemove) {
      const index = this.modifiers.findIndex((m) => m.id === mod.id);
      if (index >= 0) {
        this.modifiers.splice(index, 1);
        removed.push(mod);
        this.emit(PipelineEvents.MODIFIER_REMOVED, {
          modifier: mod,
          index,
        });
      }
    }

    return removed;
  }

  /**
   * Recursively collect all descendants of a modifier (children first).
   */
  private collectDescendants(parentId: string): Modifier[] {
    const children = this.modifiers.filter((m) => m.parentId === parentId);
    const result: Modifier[] = [];
    for (const child of children) {
      // Depth-first: collect child's descendants first
      result.push(...this.collectDescendants(child.id));
      result.push(child);
    }
    return result;
  }

  /**
   * Get all modifiers in the pipeline.
   */
  getModifiers(): readonly Modifier[] {
    return this.modifiers;
  }

  /**
   * Get direct children of a given parent modifier.
   */
  getChildren(parentId: string): Modifier[] {
    return this.modifiers.filter((m) => m.parentId === parentId);
  }

  /**
   * Set the parent of a modifier, establishing a DAG edge.
   *
   * Validates:
   * - Target modifier exists
   * - No self-reference
   * - parentId references a selection-producing modifier or is null
   * - Target is not topology-changing
   * - Target is not SelectionInsensitive category
   *
   * Returns true if the parent was set, false if validation failed.
   */
  setParent(modifierId: string, parentId: string | null): boolean {
    const target = this.modifiers.find((m) => m.id === modifierId);
    if (!target) {
      return false;
    }

    // No self-reference
    if (parentId !== null && modifierId === parentId) {
      return false;
    }

    // Topology-changing modifiers cannot have parents
    if (isTopologyChanging(target)) {
      return false;
    }

    // Modifiers that don't consume selection have nothing to gain from a
    // parent selection edge.
    if (!target.capabilities.has(ModifierCapability.ConsumesSelection)) {
      return false;
    }

    if (parentId !== null) {
      // Parent must exist and be a selection producer
      const parent = this.modifiers.find((m) => m.id === parentId);
      if (!parent) {
        return false;
      }
      if (!isSelectionProducer(parent)) {
        return false;
      }
    }

    const oldParentId = target.parentId;
    target.parentId = parentId;

    this.emit(PipelineEvents.MODIFIER_REPARENTED, {
      modifierId,
      oldParentId,
      newParentId: parentId,
    });

    return true;
  }

  /**
   * Reorder modifiers by moving a modifier to a new position.
   */
  reorderModifier(modifierId: string, newIndex: number): boolean {
    const oldIndex = this.modifiers.findIndex((m) => m.id === modifierId);
    if (oldIndex < 0 || newIndex < 0 || newIndex >= this.modifiers.length) {
      return false;
    }

    const [modifier] = this.modifiers.splice(oldIndex, 1);
    this.modifiers.splice(newIndex, 0, modifier);
    this.emit(PipelineEvents.MODIFIER_REORDERED, {
      modifier,
      oldIndex,
      newIndex,
    });
    return true;
  }

  /**
   * Compute the result of applying all modifiers to a frame.
   *
   * DAG parent resolution rules (array order = execution order):
   * - parentId !== null: look up selectionCache for the parent's mask.
   *   If found, set context.currentSelection = parentMask.
   *   If not found (parent appears later or is disabled), leave currentSelection
   *   as-is (defaults to all-atoms from createDefaultContext).
   * - parentId === null: reset context.currentSelection to all-atoms.
   *
   * After each modifier's apply(), if the modifier is a selection producer,
   * its output (context.currentSelection) is cached in context.selectionCache.
   */
  async compute(
    source: FrameSource,
    frameIndex: number,
    app: MolvisApp,
    changeKind: FrameChangeKind = "full",
  ): Promise<Frame> {
    // Load initial frame
    let frame = await source.getFrame(frameIndex);

    // Create initial context
    const context = createDefaultContext(frame, app, frameIndex, changeKind);

    // Derive atom count for all-atoms mask resets
    const atomsBlock = frame.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    // Apply each enabled modifier sequentially
    for (const modifier of this.modifiers) {
      if (!modifier.enabled) {
        continue;
      }

      // --- PRE-APPLY: resolve parentId to set context.currentSelection ---
      if (modifier.parentId !== null) {
        const parentMask = context.selectionCache.get(modifier.parentId);
        if (parentMask !== undefined) {
          context.currentSelection = parentMask;
        }
        // If parent not in cache (appears later or disabled), leave
        // currentSelection as-is (all-atoms default or whatever it was).
      } else {
        // Root-level modifier: reset to all-atoms
        context.currentSelection = SelectionMask.all(atomCount);
      }

      // Validate modifier
      const validation = modifier.validate(frame, context);
      if (!validation.valid) {
        logger.warn(
          `Modifier ${modifier.name} validation failed:`,
          validation.errors,
        );
        continue;
      }

      // Apply modifier (modifiers are pure functions)
      frame = modifier.apply(frame, context);

      // --- POST-APPLY: cache selection if this is a selection producer ---
      if (isSelectionProducer(modifier)) {
        context.selectionCache.set(modifier.id, context.currentSelection);
      }
    }

    this.emit(PipelineEvents.COMPUTED, { frame, context });
    return frame;
  }

  /**
   * Clear all modifiers from the pipeline.
   */
  clear(): void {
    this.modifiers = [];
    this.emit(PipelineEvents.PIPELINE_CLEARED, {} as Record<string, never>);
  }
}
