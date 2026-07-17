import type { Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import { EventEmitter } from "../events";
import {
  type CompositionSource,
  composeSources,
} from "../system/source_composition";
import { logger } from "../utils/logger";
import { DataSourceModifier } from "./data_source_modifier";
import { type Modifier, ModifierCapability } from "./modifier";
import {
  generateNatoId,
  isSelectionProducer,
  isTopologyChanging,
} from "./nato_ids";
import {
  createDefaultContext,
  type FrameChangeKind,
  type PipelineContext,
  SelectionMask,
} from "./types";

export interface PipelineEventMap {
  "modifier-added": { modifier: Modifier; index: number };
  "modifier-removed": { modifier: Modifier; index: number };
  "modifier-reordered": {
    modifier: Modifier;
    oldIndex: number;
    newIndex: number;
  };
  "modifier-scope-changed": {
    modifierId: string;
    oldSelectionScopeId: string | null;
    newSelectionScopeId: string | null;
  };
  "modifier-owner-changed": {
    modifierId: string;
    oldSourceOwnerId: string | null;
    newSourceOwnerId: string | null;
  };
  "pipeline-cleared": Record<string, never>;
  computed: { frame: Frame; context: PipelineContext };
}

export const PipelineEvents = {
  MODIFIER_ADDED: "modifier-added" as const,
  MODIFIER_REMOVED: "modifier-removed" as const,
  MODIFIER_REORDERED: "modifier-reordered" as const,
  MODIFIER_SCOPE_CHANGED: "modifier-scope-changed" as const,
  MODIFIER_OWNER_CHANGED: "modifier-owner-changed" as const,
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
   * Add a modifier to the pipeline.
   *
   * **Auto-positioning**: a `TransformsData`-only modifier (e.g. WrapPBC,
   * a future RecenterBox, a topology-rewriter) is inserted *before* the
   * first `Draws`-capability modifier already in the pipeline. Otherwise
   * it would land after DrawAtoms / DrawBonds / DrawBox and the
   * downstream draws would render the un-transformed coordinates,
   * silently invalidating the transform. Modifiers that are also
   * `Draws` (e.g. DrawRibbon does both) and pure `Draws` modifiers
   * append normally, preserving the user's left-to-right ordering of
   * draw layers.
   */
  addModifier(modifier: Modifier): void {
    // Auto-assign NATO ID — the pipeline owns IDs, not the caller
    const usedIds = new Set(this.modifiers.map((m) => m.id));
    (modifier as { id: string }).id = generateNatoId(usedIds);

    const isTransform = modifier.capabilities.has(
      ModifierCapability.TransformsData,
    );
    const isDraw = modifier.capabilities.has(ModifierCapability.Draws);

    let insertIndex = this.modifiers.length;
    if (isTransform && !isDraw) {
      const firstDraw = this.modifiers.findIndex((m) =>
        m.capabilities.has(ModifierCapability.Draws),
      );
      if (firstDraw !== -1) insertIndex = firstDraw;
    }
    this.modifiers.splice(insertIndex, 0, modifier);
    this.emit(PipelineEvents.MODIFIER_ADDED, {
      modifier,
      index: insertIndex,
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

    const removedIds = new Set(removed.map((m) => m.id));
    for (const modifier of this.modifiers) {
      if (
        modifier.selectionScopeId !== null &&
        removedIds.has(modifier.selectionScopeId)
      ) {
        const oldSelectionScopeId = modifier.selectionScopeId;
        modifier.selectionScopeId = null;
        this.emit(PipelineEvents.MODIFIER_SCOPE_CHANGED, {
          modifierId: modifier.id,
          oldSelectionScopeId,
          newSelectionScopeId: null,
        });
      }
    }

    return removed;
  }

  /**
   * Recursively collect all descendants of a modifier (children first).
   */
  private collectDescendants(sourceOwnerId: string): Modifier[] {
    const children = this.modifiers.filter(
      (m) => m.sourceOwnerId === sourceOwnerId,
    );
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
   * Number of enabled DataSourceModifiers — the same set the composition head
   * walks. Callers use this to detect multi-DS pipelines without
   * leaking the filter logic.
   */
  enabledDataSourceCount(): number {
    let n = 0;
    for (const m of this.modifiers) {
      if (m.enabled && m instanceof DataSourceModifier) n++;
    }
    return n;
  }

  /**
   * Get direct children of a given source owner.
   */
  getChildren(sourceOwnerId: string): Modifier[] {
    return this.modifiers.filter((m) => m.sourceOwnerId === sourceOwnerId);
  }

  /**
   * Attach a modifier to a selection-producing scope. This is the only
   * execution dependency between modifiers; source ownership is handled by
   * {@link setSourceOwner} and is UI/lifecycle only.
   */
  setSelectionScope(
    modifierId: string,
    selectionScopeId: string | null,
  ): boolean {
    const target = this.modifiers.find((m) => m.id === modifierId);
    if (!target) return false;
    if (selectionScopeId !== null && modifierId === selectionScopeId) {
      return false;
    }
    if (
      selectionScopeId !== null &&
      !target.capabilities.has(ModifierCapability.ConsumesSelection)
    ) {
      return false;
    }
    if (selectionScopeId !== null) {
      const scope = this.modifiers.find((m) => m.id === selectionScopeId);
      if (!scope || !isSelectionProducer(scope)) return false;
    }

    const oldSelectionScopeId = target.selectionScopeId;
    target.selectionScopeId = selectionScopeId;
    this.emit(PipelineEvents.MODIFIER_SCOPE_CHANGED, {
      modifierId,
      oldSelectionScopeId,
      newSelectionScopeId: selectionScopeId,
    });
    return true;
  }

  /**
   * Attach a modifier to a source node for tree ownership. This does not affect
   * execution order or selection scope.
   */
  setSourceOwner(modifierId: string, sourceOwnerId: string | null): boolean {
    const target = this.modifiers.find((m) => m.id === modifierId);
    if (!target) return false;
    if (sourceOwnerId !== null && modifierId === sourceOwnerId) return false;
    if (isTopologyChanging(target)) return false;
    if (sourceOwnerId !== null) {
      const owner = this.modifiers.find((m) => m.id === sourceOwnerId);
      if (!(owner instanceof DataSourceModifier)) return false;
    }
    const oldSourceOwnerId = target.sourceOwnerId;
    target.sourceOwnerId = sourceOwnerId;
    this.emit(PipelineEvents.MODIFIER_OWNER_CHANGED, {
      modifierId,
      oldSourceOwnerId,
      newSourceOwnerId: sourceOwnerId,
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
   * Compute the augment-composed frame at `frameIndex` and apply all enabled
   * non-source modifiers in array order.
   */
  async compute(
    frameIndex: number,
    app: MolvisApp,
    changeKind: FrameChangeKind = "full",
  ): Promise<Frame> {
    const sources: CompositionSource[] = [];
    for (const m of this.modifiers) {
      if (m.enabled && m instanceof DataSourceModifier) {
        sources.push({
          id: m.id,
          trajectory: m.trajectory,
          contributedBlocks:
            m.contributedBlocks.length > 0 ? m.contributedBlocks : undefined,
        });
      }
    }
    let frame = await composeSources(sources, frameIndex);

    // --- Phase B: apply non-DS modifiers in array order ---
    const context = createDefaultContext(frame, app, frameIndex, changeKind);
    const atomsBlock = frame.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    for (const modifier of this.modifiers) {
      if (!modifier.enabled) continue;
      // DSs already contributed in the composition head; their identity apply()
      // is a no-op and skipping it here is semantically equivalent and
      // saves a function call per DS per compute.
      if (modifier instanceof DataSourceModifier) continue;

      if (modifier.selectionScopeId !== null) {
        const scopedMask = context.selectionCache.get(
          modifier.selectionScopeId,
        );
        if (scopedMask !== undefined) {
          context.currentSelection = scopedMask;
        }
      } else {
        context.currentSelection = SelectionMask.all(atomCount);
      }

      const validation = modifier.validate(frame, context);
      if (!validation.valid) {
        logger.warn(
          `Modifier ${modifier.name} validation failed:`,
          validation.errors,
        );
        continue;
      }

      // `await` covers both sync (Frame) and async (Promise<Frame>)
      // returns — see Modifier.apply doc. Draw modifiers rely on this
      // to flush shader-compile awaits before applySceneIndexToMeshes.
      frame = await modifier.apply(frame, context);

      if (isSelectionProducer(modifier)) {
        context.selectionCache.set(modifier.id, context.currentSelection);
      }
    }

    this.emit(PipelineEvents.COMPUTED, { frame, context });
    return frame;
  }

  /**
   * Clear all modifiers from the pipeline. Disposes every
   * {@link DataSourceModifier} so its WASM resources (and any
   * streaming worker / OPFS handles owned by a wrapped trajectory)
   * are released deterministically rather than waiting for GC.
   */
  clear(): void {
    for (const modifier of this.modifiers) {
      if (modifier instanceof DataSourceModifier) {
        try {
          modifier.dispose();
        } catch (err) {
          logger.warn(
            `[pipeline.clear] DataSource ${modifier.id} dispose threw`,
            err as Error,
          );
        }
      }
    }
    this.modifiers = [];
    this.emit(PipelineEvents.PIPELINE_CLEARED, {} as Record<string, never>);
  }
}
