import { Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import { EventEmitter } from "../events";
import { logger } from "../utils/logger";
import { DataSourceModifier } from "./data_source_modifier";
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
   * Number of enabled DataSourceModifiers — the same set phase A merge
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
   * Get direct children of a given parent modifier.
   */
  getChildren(parentId: string): Modifier[] {
    return this.modifiers.filter((m) => m.parentId === parentId);
  }

  /**
   * Set the parent of a modifier, establishing a DAG edge.
   *
   * Two distinct parent kinds are allowed (multi-data-source spec phase 2):
   *
   * 1. **Selection-producer parent** (existing semantics): the child
   *    consumes the parent's selection mask during phase B. Requires
   *    `ConsumesSelection` capability on the child and the parent to
   *    be a selection producer (`SelectModifier` /
   *    `ExpressionSelectionModifier`).
   * 2. **DataSourceModifier parent** (new): purely organizational —
   *    the child visually nests under the DS in the UI tree. No
   *    selection scope is implied; auto-attached `Draw*` modifiers
   *    use this to express "this Draw came along with this DS".
   *    The child is NOT required to consume selection.
   *
   * Common validation:
   * - Target modifier exists
   * - No self-reference
   * - Target is not topology-changing (those reset the world and
   *   don't make sense as children)
   * - Parent (if non-null) exists and is one of the two valid kinds
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

    if (parentId !== null) {
      const parent = this.modifiers.find((m) => m.id === parentId);
      if (!parent) {
        return false;
      }

      const parentIsDataSource = parent instanceof DataSourceModifier;
      const parentIsSelectionProducer = isSelectionProducer(parent);
      if (!parentIsDataSource && !parentIsSelectionProducer) {
        return false;
      }

      // Selection-edge parent requires the child to consume selection.
      // DS-edge parent is purely organizational; any non-topology-changing
      // child is welcome.
      if (
        !parentIsDataSource &&
        !target.capabilities.has(ModifierCapability.ConsumesSelection)
      ) {
        return false;
      }
    }
    // parentId === null: detach (always allowed for non-topology-changing
    // modifiers — already gated above).

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
   * Compute the merged frame at `frameIndex` and apply all enabled
   * modifiers. Two-phase execution per the multi-data-source spec:
   *
   * - **Phase A (DS merge)**: pre-load every enabled
   *   {@link DataSourceModifier}'s frame for `frameIndex` (in parallel),
   *   then walk DSs in array order and inject each DS's
   *   `contributedBlocks` into a fresh working `Frame`. Last DS wins
   *   on block-name conflict; `simbox` follows the same last-wins rule.
   * - **Phase B (modifier apply)**: walk every enabled non-DS modifier
   *   in array order, applying it to the working frame. Existing DAG
   *   parent / selection-producer semantics are preserved unchanged.
   *
   * `overrideFrame` is a transitional bridge for legacy callers that
   * still hand the pipeline a pre-built frame (`app.applyPipeline({
   * sourceFrame })`). When provided, phase A is skipped and the
   * override is treated as the merged frame; phase B runs as usual.
   * Tasks #3–#4 of the spec retire the override path.
   *
   * DAG parent resolution rules (phase B):
   * - `parentId !== null`: look up `selectionCache` for the parent's
   *   mask. If found, set `currentSelection = parentMask`. If not
   *   found (parent appears later or is disabled), leave
   *   `currentSelection` as-is (defaults to all-atoms).
   * - `parentId === null`: reset `currentSelection` to all-atoms.
   *
   * After each modifier's apply(), if the modifier is a selection
   * producer its output (`currentSelection`) is cached in
   * `selectionCache` keyed by its id.
   */
  async compute(
    frameIndex: number,
    app: MolvisApp,
    changeKind: FrameChangeKind = "full",
    overrideFrame?: Frame,
  ): Promise<Frame> {
    let frame: Frame;

    if (overrideFrame !== undefined) {
      // Legacy bridge: skip phase A, treat the override as the merged
      // frame. Used by `app.applyPipeline({ sourceFrame })` until the
      // remaining phase-1 tasks migrate all callers onto the DS path.
      frame = overrideFrame;
    } else {
      // --- Phase A: build the merged frame from DS contributions ---
      const dsModifiers: DataSourceModifier[] = [];
      for (const m of this.modifiers) {
        if (m.enabled && m instanceof DataSourceModifier) dsModifiers.push(m);
      }

      // Pre-load each DS's frame for the requested index (parallel).
      await Promise.all(dsModifiers.map((ds) => ds.preload(frameIndex)));

      frame = new Frame();
      for (const ds of dsModifiers) {
        const src = ds.cachedFrame;
        // Empty `contributedBlocks` means "everything the source frame
        // actually has" — the WASM Frame is the source of truth, not a
        // hardcoded registry. Populated `contributedBlocks` is a user-
        // set narrowing filter (topology-only file → ["bonds"]).
        const blockNames =
          ds.contributedBlocks.length > 0
            ? ds.contributedBlocks
            : src.blockNames();
        for (const name of blockNames) {
          const block = src.getBlock(name);
          // Skip 0-row blocks so a topology-only DS that happens to
          // carry an empty `atoms` placeholder doesn't shadow another
          // DS's real atoms via the last-wins rule.
          if (block !== undefined && block.nrows() > 0) {
            // Last-wins on block-name conflict. molrs Block::clone is an
            // Arc::clone (refcount bump), so this is O(num_columns).
            frame.insertBlock(name, block);
          }
        }
        if (src.simbox !== undefined) {
          frame.simbox = src.simbox;
        }
      }
    }

    // --- Phase B: apply non-DS modifiers in array order ---
    const context = createDefaultContext(frame, app, frameIndex, changeKind);
    const atomsBlock = frame.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    for (const modifier of this.modifiers) {
      if (!modifier.enabled) continue;
      // DSs already contributed in phase A; their identity apply() is
      // a no-op and skipping it here is semantically equivalent and
      // saves a function call per DS per compute.
      if (modifier instanceof DataSourceModifier) continue;

      // --- PRE-APPLY: resolve parentId to set context.currentSelection ---
      if (modifier.parentId !== null) {
        const parentMask = context.selectionCache.get(modifier.parentId);
        if (parentMask !== undefined) {
          context.currentSelection = parentMask;
        }
        // If parent not in cache (appears later or is disabled), leave
        // currentSelection as-is.
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
