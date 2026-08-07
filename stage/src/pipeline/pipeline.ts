import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { EventEmitter } from "../events";
import {
  type CompositionSource,
  composeSources,
} from "../system/source_composition";
import { logger } from "../utils/logger";
import { DataSource } from "./data_source";
import { DrawBoxModifier } from "./draw_box";
import type { PipelineEntry } from "./entry";
import { type Modifier, ModifierCapability } from "./modifier";
import {
  generateNatoId,
  isSelectionProducer,
  isTopologyChanging,
} from "./nato_ids";
import { Session } from "./session";
import {
  createDefaultContext,
  type FrameChangeKind,
  type PipelineContext,
  SelectionMask,
} from "./types";

export interface PipelineEventMap {
  // Membership events cover every row in the list, sources included, so they
  // are named for `PipelineEntry` rather than for one of its two implementors.
  "entry-added": { entry: PipelineEntry; index: number };
  "entry-removed": { entry: PipelineEntry; index: number };
  "entry-reordered": {
    entry: PipelineEntry;
    oldIndex: number;
    newIndex: number;
  };
  // Scope and ownership are modifier-only: a source consumes no selection and
  // is never owned by another entry.
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
  ENTRY_ADDED: "entry-added" as const,
  ENTRY_REMOVED: "entry-removed" as const,
  ENTRY_REORDERED: "entry-reordered" as const,
  MODIFIER_SCOPE_CHANGED: "modifier-scope-changed" as const,
  MODIFIER_OWNER_CHANGED: "modifier-owner-changed" as const,
  PIPELINE_CLEARED: "pipeline-cleared" as const,
  COMPUTED: "computed" as const,
};

/**
 * The pipeline: one ordered list of {@link PipelineEntry}, computed in two
 * phases.
 *
 * Phase A composes every enabled {@link DataSource} into a single frame
 * (`system/source_composition.ts`). Sources are unordered — composition merges
 * by block, not by list position — so where a source sits in the list is a
 * display concern only.
 *
 * Phase B runs every enabled {@link Modifier} in {@link executionOrder}. Here
 * order *is* the semantics.
 *
 * The two live in one array because the UI presents one list and the project
 * / state-sync formats serialise one list. {@link sources} and
 * {@link modifiers} hand out the two views, so callers state which kind they
 * mean instead of filtering a mixed array by `instanceof`.
 */
export class ModifierPipeline extends EventEmitter<PipelineEventMap> {
  private entries: PipelineEntry[] = [];

  /** Assign the pipeline-owned NATO id. Ids belong to the list, not the caller. */
  private assignId(entry: PipelineEntry): void {
    const usedIds = new Set(this.entries.map((e) => e.id));
    (entry as { id: string }).id = generateNatoId(usedIds);
  }

  /**
   * Add a data source to the pipeline.
   *
   * Placed ahead of the first drawing modifier, which is where sources landed
   * back when they were `TransformsData`-capable modifiers and
   * {@link addModifier} positioned them by capability. The position has no
   * effect on composition — it keeps sources at the head of the displayed list
   * instead of appearing below the draws they feed.
   */
  addSource(source: DataSource): void {
    this.assignId(source);
    const index = this.firstDrawIndex() ?? this.entries.length;
    this.entries.splice(index, 0, source);
    this.emit(PipelineEvents.ENTRY_ADDED, { entry: source, index });
  }

  /**
   * Install the controller session, replacing any previous one.
   *
   * Replacement rather than append is what caps the cardinality at one: there
   * is no state in which two sessions exist, so no runtime check to forget.
   * The outgoing session is removed through the normal path, so its
   * `onRemoved` disconnects it.
   *
   * The session sits at the head of the list, above the sources — it is the
   * thing that put most of them there.
   */
  setSession(session: Session): void {
    const previous = this.session();
    if (previous) this.removeEntry(previous.id);
    this.assignId(session);
    this.entries.unshift(session);
    this.emit(PipelineEvents.ENTRY_ADDED, { entry: session, index: 0 });
  }

  /** The controller session, or `null` when nothing is driving this app. */
  session(): Session | null {
    return this.entries.find((e): e is Session => e instanceof Session) ?? null;
  }

  /** Index of the first `Draws`-capability modifier, or `null` if there is none. */
  private firstDrawIndex(): number | null {
    const i = this.entries.findIndex(
      (e) =>
        !(e instanceof DataSource) &&
        !(e instanceof Session) &&
        (e as Modifier).capabilities.has(ModifierCapability.Draws),
    );
    return i === -1 ? null : i;
  }

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
    this.assignId(modifier);

    const isTransform = modifier.capabilities.has(
      ModifierCapability.TransformsData,
    );
    const isDraw = modifier.capabilities.has(ModifierCapability.Draws);

    let insertIndex = this.entries.length;
    if (isTransform && !isDraw) {
      const firstDraw = this.firstDrawIndex();
      if (firstDraw !== null) insertIndex = firstDraw;
    }
    this.entries.splice(insertIndex, 0, modifier);
    this.emit(PipelineEvents.ENTRY_ADDED, {
      entry: modifier,
      index: insertIndex,
    });
  }

  /**
   * Remove an entry from the pipeline — a modifier or a data source.
   * Cascade-removes all children (recursively) before removing the target.
   * Returns the full list of removed entries (children first, then target).
   * Returns an empty array if the entry was not found.
   *
   * A removed {@link DataSource} is **not** disposed here; freeing its WASM
   * has to wait until `System` has been re-pointed at a surviving trajectory.
   * `SceneSession.removeDataSource` sequences that and disposes what this
   * returns.
   */
  removeEntry(entryId: string): PipelineEntry[] {
    const target = this.entries.find((e) => e.id === entryId);
    if (!target) {
      return [];
    }

    // Collect all descendants recursively
    const toRemove: PipelineEntry[] = this.collectDescendants(entryId);
    toRemove.push(target);

    const removed: PipelineEntry[] = [];
    for (const entry of toRemove) {
      const index = this.entries.findIndex((e) => e.id === entry.id);
      if (index >= 0) {
        this.entries.splice(index, 1);
        removed.push(entry);
        // Tear down side-effects (camera observers, overlays, …) before
        // the instance is dropped from the pipeline.
        try {
          entry.onRemoved?.();
        } catch {
          /* teardown must not block remove */
        }
        this.emit(PipelineEvents.ENTRY_REMOVED, {
          entry,
          index,
        });
      }
    }

    const removedIds = new Set(removed.map((e) => e.id));
    for (const modifier of this.modifiers()) {
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
   * Recursively collect all descendants of an entry (children first). Only
   * modifiers can be children — ownership is a modifier-side field, so a
   * source is always a root.
   */
  private collectDescendants(sourceOwnerId: string): Modifier[] {
    const children = this.getChildren(sourceOwnerId);
    const result: Modifier[] = [];
    for (const child of children) {
      // Depth-first: collect child's descendants first
      result.push(...this.collectDescendants(child.id));
      result.push(child);
    }
    return result;
  }

  /**
   * Every entry, in list order — the view the UI renders and the project /
   * state-sync formats serialise. Use {@link sources} or {@link modifiers}
   * when you mean one kind; this is for callers that genuinely mean "the
   * list".
   */
  getEntries(): readonly PipelineEntry[] {
    return this.entries;
  }

  /**
   * The data sources, in list order. This is the set the composition head
   * walks (after filtering by `enabled`).
   */
  sources(): readonly DataSource[] {
    return this.entries.filter((e): e is DataSource => e instanceof DataSource);
  }

  /**
   * The modifiers, in list order. Execution reorders them further — see
   * {@link executionOrder}.
   */
  modifiers(): readonly Modifier[] {
    return this.entries.filter(
      (e): e is Modifier =>
        !(e instanceof DataSource) && !(e instanceof Session),
    );
  }

  /**
   * Number of enabled data sources — the same set the composition head walks.
   * Callers use this to detect multi-source pipelines without restating the
   * filter.
   */
  enabledSourceCount(): number {
    let n = 0;
    for (const s of this.sources()) {
      if (s.enabled) n++;
    }
    return n;
  }

  /**
   * Get direct children of a given source owner.
   */
  getChildren(sourceOwnerId: string): Modifier[] {
    return this.modifiers().filter((m) => m.sourceOwnerId === sourceOwnerId);
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
    const target = this.modifiers().find((m) => m.id === modifierId);
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
      const scope = this.modifiers().find((m) => m.id === selectionScopeId);
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
    const target = this.modifiers().find((m) => m.id === modifierId);
    if (!target) return false;
    if (sourceOwnerId !== null && modifierId === sourceOwnerId) return false;
    if (isTopologyChanging(target)) return false;
    if (sourceOwnerId !== null) {
      const owner = this.entries.find((e) => e.id === sourceOwnerId);
      if (!(owner instanceof DataSource)) return false;
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
   * Move an entry to a new position in the list. Indices address the whole
   * list, which is what the UI drags over. Reordering a {@link DataSource}
   * changes nothing about the computed frame — composition does not read list
   * position — so it is a display-order change only.
   */
  reorderEntry(entryId: string, newIndex: number): boolean {
    const oldIndex = this.entries.findIndex((e) => e.id === entryId);
    if (oldIndex < 0 || newIndex < 0 || newIndex >= this.entries.length) {
      return false;
    }

    const [entry] = this.entries.splice(oldIndex, 1);
    this.entries.splice(newIndex, 0, entry);
    this.emit(PipelineEvents.ENTRY_REORDERED, {
      entry,
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
    for (const s of this.sources()) {
      if (!s.enabled) continue;
      sources.push({
        id: s.id,
        trajectory: s.trajectory,
        contributedBlocks:
          s.contributedBlocks.length > 0 ? s.contributedBlocks : undefined,
      });
    }
    let frame = await composeSources(sources, frameIndex);

    // --- Phase B: apply non-DS modifiers ---
    // Pure TransformsData modifiers (WrapPBC, Slice, …) always run before
    // any Draws-capable modifier, even if the user reordered the list so a
    // transform sits after Particles. Otherwise the visual would render
    // un-transformed coordinates and the transform would appear broken.
    // Relative order within each group is preserved (stable partition).
    const context = createDefaultContext(frame, app, frameIndex, changeKind);
    const atomsBlock = frame.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    const applyOrder = executionOrder(this.modifiers());

    for (const modifier of applyOrder) {
      if (!modifier.enabled) continue;

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
   * Clear every entry from the pipeline. Disposes each {@link DataSource} so
   * its WASM resources (and any streaming worker / OPFS handles owned by a
   * wrapped trajectory) are released deterministically rather than waiting
   * for GC.
   */
  clear(): void {
    // Teardown, same as `removeEntry` — clearing *is* removal. Without this a
    // Session kept its socket and a CameraTrackModifier kept its observers,
    // because `clear` only ever disposed sources.
    for (const entry of this.entries) {
      try {
        entry.onRemoved?.();
      } catch (err) {
        logger.warn(
          `[pipeline.clear] entry ${entry.id} teardown threw`,
          err as Error,
        );
      }
    }
    for (const source of this.sources()) {
      try {
        source.dispose();
      } catch (err) {
        logger.warn(
          `[pipeline.clear] DataSource ${source.id} dispose threw`,
          err as Error,
        );
      }
    }
    this.entries = [];
    this.emit(PipelineEvents.PIPELINE_CLEARED, {} as Record<string, never>);
  }
}

/**
 * Stable partition for pipeline execution (three bands):
 *
 * 1. **Frame-box providers** — manual {@link DrawBoxModifier} that write
 *    `frame.box` (user-defined lattice). Must run first so pure geometry
 *    transforms can read the cell from the frame alone.
 * 2. **Pure `TransformsData`** (no `Draws`) — WrapPBC, Slice, Color, …
 * 3. **Everything else** — Draws, dual-capability (e.g. DrawRibbon), Select.
 *
 * Relative order within each band is preserved.
 */
export function executionOrder(
  modifiers: readonly Modifier[],
): readonly Modifier[] {
  const boxProviders: Modifier[] = [];
  const transforms: Modifier[] = [];
  const rest: Modifier[] = [];
  for (const m of modifiers) {
    if (isFrameBoxProvider(m)) {
      boxProviders.push(m);
      continue;
    }
    const isTransform = m.capabilities.has(ModifierCapability.TransformsData);
    const isDraw = m.capabilities.has(ModifierCapability.Draws);
    if (isTransform && !isDraw) {
      transforms.push(m);
    } else {
      rest.push(m);
    }
  }
  if (boxProviders.length === 0 && transforms.length === 0) {
    return modifiers;
  }
  return [...boxProviders, ...transforms, ...rest];
}

function isFrameBoxProvider(modifier: Modifier): boolean {
  return (
    modifier instanceof DrawBoxModifier && modifier.providesFrameBox === true
  );
}
