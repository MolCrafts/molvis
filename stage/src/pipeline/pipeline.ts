import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { applyWrapIfEnabled } from "../coords";
import { EventEmitter } from "../events";
import {
  type CompositionSource,
  composeSources,
} from "../system/source_composition";
import { logger } from "../utils/logger";
import { DataSource } from "./data_source";
import { DrawBoxModifier } from "./draw_box";
import type { PipelineEntry } from "./entry";
import { MeshOverlayModifier } from "./mesh_overlay";
import {
  type GeometryProducer,
  type Modifier,
  ModifierCapability,
  producesGeometry,
} from "./modifier";
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

export interface AddModifierOptions {
  /**
   * Give a `ProducesGeometry` modifier its draw companion. Default true.
   * Set false when the caller supplies the draw itself.
   */
  attachDraw?: boolean;
}

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
 * (`system/source_composition.ts`). A length-1 source plus an N-frame
 * trajectory compose as topology + coordinates regardless of list order.
 * Same-kind overlapping columns still later-win. List position is otherwise
 * a display concern.
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
  /**
   * System wrap gate after DataSource compose. When true, atom columns are
   * folded with {@link applyWrapIfEnabled} once; edge bonds use draw-time MI.
   */
  private _wrapEnabled = false;

  get wrapEnabled(): boolean {
    return this._wrapEnabled;
  }

  /** Enable or disable the post-compose atom wrap gate. */
  setWrapEnabled(enabled: boolean): void {
    if (this._wrapEnabled === enabled) return;
    this._wrapEnabled = enabled;
  }

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

  /**
   * Take the session out of the list **without** running its teardown.
   *
   * The one caller is `pipeline.clear` over RPC, which must answer before the
   * transport it answers on goes away. Everything else should use
   * {@link removeEntry}, which disconnects.
   */
  detachSession(): Session | null {
    const session = this.session();
    if (!session) return null;
    const index = this.entries.indexOf(session);
    this.entries.splice(index, 1);
    this.emit(PipelineEvents.ENTRY_REMOVED, { entry: session, index });
    return session;
  }

  /** The controller session, or `null` when nothing is driving this app. */
  session(): Session | null {
    return this.entries.find((e): e is Session => e instanceof Session) ?? null;
  }

  /**
   * Give a geometry producer its draw companion, owned by it.
   *
   * Ownership does double duty: the pipeline tree already nests entries by
   * `sourceOwnerId`, so the draw renders indented under its producer, and
   * {@link removeEntry}'s descendant sweep takes it away when the producer
   * goes — no bespoke cascade for either.
   */
  private attachDraw(producer: Modifier & GeometryProducer): void {
    const draw = producer.createDraw();
    this.assignId(draw);
    draw.sourceOwnerId = producer.id;
    const index = this.entries.indexOf(producer) + 1;
    this.entries.splice(index, 0, draw);
    this.emit(PipelineEvents.ENTRY_ADDED, { entry: draw, index });
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
   * **Auto-positioning**: a `TransformsData`-only modifier (e.g. Slice,
   * a future RecenterBox, a topology-rewriter) is inserted *before* the
   * first `Draws`-capability modifier already in the pipeline. Otherwise
   * it would land after DrawAtoms / DrawBonds / DrawBox and the
   * downstream draws would render the un-transformed coordinates,
   * silently invalidating the transform. Modifiers that are also
   * `Draws` (e.g. DrawRibbon does both) and pure `Draws` modifiers
   * append normally, preserving the user's left-to-right ordering of
   * draw layers.
   */
  addModifier(modifier: Modifier, options?: AddModifierOptions): void {
    this.assignId(modifier);

    const isTransform = modifier.capabilities.has(
      ModifierCapability.TransformsData,
    );
    const isDraw = modifier.capabilities.has(ModifierCapability.Draws);
    const isProducer = modifier.capabilities.has(
      ModifierCapability.ProducesGeometry,
    );

    let insertIndex = this.entries.length;
    if ((isTransform || isProducer) && !isDraw) {
      const firstDraw = this.firstDrawIndex();
      if (firstDraw !== null) insertIndex = firstDraw;
    }
    this.entries.splice(insertIndex, 0, modifier);
    this.emit(PipelineEvents.ENTRY_ADDED, {
      entry: modifier,
      index: insertIndex,
    });

    if (options?.attachDraw !== false && producesGeometry(modifier)) {
      this.attachDraw(modifier);
    }
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

  /** Live Mesh overlay rows — view geometry, not DataSources. */
  meshOverlayCount(): number {
    let n = 0;
    for (const m of this.modifiers()) {
      if (m instanceof MeshOverlayModifier) n++;
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
      if (!owner || owner instanceof Session) return false;
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
   * Phase A: compose enabled sources at `frameIndex` and apply the wrap
   * gate. Callers that need to classify the transition before draws run
   * this once and pass the result into {@link compute} as `precomposed`.
   */
  async composeHead(frameIndex: number): Promise<Frame> {
    const sources: CompositionSource[] = [];
    for (const s of this.sources()) {
      if (!s.enabled) continue;
      sources.push({
        id: s.id,
        label: s.filename || s.name,
        trajectory: s.trajectory,
        contributedBlocks:
          s.contributedBlocks.length > 0 ? s.contributedBlocks : undefined,
      });
    }
    const frame = await composeSources(sources, frameIndex);
    return applyWrapIfEnabled(frame, this._wrapEnabled);
  }

  /**
   * Compute the augment-composed frame at `frameIndex` and apply all enabled
   * non-source modifiers in array order.
   *
   * Pass `precomposed` to skip a second compose when the caller already
   * ran {@link composeHead} (playback classification).
   */
  async compute(
    frameIndex: number,
    app: MolvisApp,
    changeKind: FrameChangeKind = "full",
    precomposed?: Frame,
  ): Promise<Frame> {
    let frame = precomposed ?? (await this.composeHead(frameIndex));

    // --- Phase B: apply non-DS modifiers ---
    // Pure TransformsData modifiers (Slice, …) always run before
    // any Draws-capable modifier, even if the user reordered the list so a
    // transform sits after Particles. Otherwise the visual would render
    // un-transformed coordinates and the transform would appear broken.
    // Relative order within each group is preserved (stable partition).
    const context = createDefaultContext(frame, app, frameIndex, changeKind);
    const atomsBlock = frame.has("atoms") ? frame.get("atoms") : undefined;
    const atomCount = atomsBlock?.nRows ?? 0;

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
  clear(options?: { keepMeshOverlays?: boolean }): void {
    const keepIds = new Set<string>();
    if (options?.keepMeshOverlays) {
      const session = this.session();
      if (session) keepIds.add(session.id);
      for (const m of this.modifiers()) {
        if (!(m instanceof MeshOverlayModifier)) continue;
        keepIds.add(m.id);
        for (const child of this.getChildren(m.id)) keepIds.add(child.id);
      }
    }

    // Teardown, same as `removeEntry` — clearing *is* removal. Without this a
    // Session kept its socket and a CameraTrackModifier kept its observers,
    // because `clear` only ever disposed sources.
    const kept: PipelineEntry[] = [];
    for (const entry of this.entries) {
      if (keepIds.has(entry.id)) {
        kept.push(entry);
        continue;
      }
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
      if (keepIds.has(source.id)) continue;
      try {
        source.dispose();
      } catch (err) {
        logger.warn(
          `[pipeline.clear] DataSource ${source.id} dispose threw`,
          err as Error,
        );
      }
    }
    this.entries = kept;
    this.emit(PipelineEvents.PIPELINE_CLEARED, {} as Record<string, never>);
  }
}

/**
 * Stable execution order for pipeline modifiers.
 *
 * Two forces drive ordering:
 *
 * 1. **Capability bands** (for unrelated modifiers, preserves the legacy
 *    semantics): box providers → pure transforms → selection producers →
 *    selection-consuming transforms → draws / dual-capability.
 * 2. **Selection-scope dependencies**: a modifier whose
 *    `selectionScopeId` references a producer must run after that producer.
 *    This is the only execution dependency between modifiers (see
 *    {@link ModifierPipeline.setSelectionScope}).
 *
 * The result is a stable topological sort over `selectionScopeId` edges.
 * When several unrelated modifiers are runnable, the lowest band wins and
 * within a band the original list order is preserved.
 */
export function executionOrder(
  modifiers: readonly Modifier[],
): readonly Modifier[] {
  const byId = new Map<string, Modifier>();
  for (const m of modifiers) byId.set(m.id, m);

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const m of modifiers) {
    indegree.set(m.id, 0);
    dependents.set(m.id, []);
  }
  for (const m of modifiers) {
    const scope = m.selectionScopeId;
    if (scope !== null && byId.has(scope)) {
      indegree.set(m.id, (indegree.get(m.id) ?? 0) + 1);
      dependents.get(scope)?.push(m.id);
    }
  }

  const remaining = new Set(modifiers.map((m) => m.id));
  const ordered: Modifier[] = [];

  while (remaining.size > 0) {
    let next: Modifier | null = null;
    let nextIndex = -1;
    for (let i = 0; i < modifiers.length; i++) {
      const m = modifiers[i];
      if (!remaining.has(m.id) || (indegree.get(m.id) ?? 0) > 0) continue;
      if (
        next === null ||
        bandPriority(m) < bandPriority(next) ||
        (bandPriority(m) === bandPriority(next) && i < nextIndex)
      ) {
        next = m;
        nextIndex = i;
      }
    }
    if (next === null) {
      // Invalid cyclic scope graph — fall back to list order for the rest so
      // no modifier is silently dropped.
      for (const m of modifiers) {
        if (remaining.has(m.id)) ordered.push(m);
      }
      break;
    }
    ordered.push(next);
    remaining.delete(next.id);
    for (const dep of dependents.get(next.id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
    }
  }

  return ordered;
}

function bandPriority(m: Modifier): number {
  if (isFrameBoxProvider(m)) return 0;
  const caps = m.capabilities;
  const transforms = caps.has(ModifierCapability.TransformsData);
  const draws = caps.has(ModifierCapability.Draws);
  const consumes = caps.has(ModifierCapability.ConsumesSelection);
  const produces = caps.has(ModifierCapability.ProducesSelection);

  // Pure geometry/topology transforms run before any selection is computed so
  // producers index the frame the user actually sees.
  if (transforms && !draws && !consumes && !produces) return 1;
  // Producers that only emit a mask (Expression, Type, Mask, Overlapping).
  if (produces && !consumes && !draws) return 2;
  // Derived producers (Select add/remove/toggle, Invert, Expand) consume an
  // upstream mask before emitting their own; scope edges order them after it.
  if (produces && consumes && !draws && !transforms) return 3;
  // Consumers that rewrite the frame (Hide, Delete, Transparent, …) must see
  // the producer's mask but still run before draws.
  if (consumes && transforms && !draws) return 4;
  // Geometry producers compute from the finished frame, so they run after
  // every edit to it — and before the draws that paint what they produced.
  if (caps.has(ModifierCapability.ProducesGeometry) && !draws) return 5;
  // Draws and dual-capability modifiers render last.
  return 6;
}

function isFrameBoxProvider(modifier: Modifier): boolean {
  return (
    modifier instanceof DrawBoxModifier && modifier.providesFrameBox === true
  );
}
