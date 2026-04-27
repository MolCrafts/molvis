# Spec: multi-data-source-pipeline

## Summary

Replace the current "single `DataSourceModifier` marker + single
`system.trajectory`" model with a model where the pipeline can host an
arbitrary number of `DataSourceModifier`s, each owning its own data
contribution. Two concrete kinds:

- **`TrajectoryDataSource`** — owns a `Trajectory` (N frames, time-varying)
- **`FrameDataSource`** — owns a single `Frame` (time-invariant; broadcast
  across all frames at compute time)

Multiple data sources contribute to the same logical *system*: at every
pipeline compute step, each DS injects its blocks into a working frame in
pipeline order, last-wins on conflict. The result is the merged `Frame`
that all downstream modifiers (Select / Hide / Color / Draw) operate on.

```
┌── Pipeline ────────────────────────────────────────────────────────────┐
│  [TrajectoryDataSource]  A.lammpstrj   1000 frames   blocks: atoms      │
│      ├── DrawAtom                                                       │
│      └── DrawBox                                                        │
│  [FrameDataSource]       B.data        1 frame       blocks: bonds      │
│      └── DrawBond                                                       │
│  [SelectModifier]        residue MET                                    │
│      └── HideSelectionModifier                                          │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓ pipeline.compute(i)
                ┌─────────────────────────────┐
                │ merged Frame at index i:    │
                │   atoms  ← A.frame[i]       │
                │   bonds  ← B.frame[0]       │
                │   simbox ← B.frame[0].box   │
                └─────────────────────────────┘
                            ↓
                  Draws → Artist → BabylonJS
```

This brings MolVis to feature parity with OVITO's `FileSource` +
`LoadTrajectoryModifier` / `CombineDatasetsModifier` workflow, supporting
the most common MD output convention: one file with positions over time +
one file with topology / static fields.

## Goals

- Load topology + trajectory from separate files into a single coherent system.
- Stack arbitrary number of data sources, each contributing a subset of blocks.
- Symmetric load order: topology-then-trajectory ≡ trajectory-then-topology.
- Strict frame-count validation: all `TrajectoryDataSource`s in one pipeline
  must agree on frame count.
- `FrameDataSource` ⇒ broadcast across all frames automatically.
- Per-DS lifecycle: removing a DS reverts its contribution (rebuild from
  remaining DSs in pipeline order).
- DS panels are visual containers in the UI: their own Draw modifiers nest
  underneath them.

## Non-goals (v1)

- **Atom-set extension**: this design is for *augmentation* (adding more
  blocks/columns to the same atoms) not *extension* (concatenating atoms
  from two files into one bigger system). The latter requires a
  `CombineSystemsModifier` or multi-pipeline UI; out of scope.
- **Per-DS atom tagging**: the merged frame does not record which DS
  contributed which atom. If user wants distinct rendering per source they
  must use color modifiers downstream. (Future work: synthetic
  `source_id` block.)
- **Reordering DSs in the pipeline**: array-order matters for last-wins
  semantics, but reordering would require a full system rebuild. Disabled
  in v1; only append + remove allowed.
- **Multi-pipeline UI**: independent systems remain a single-pipeline
  product for v1. The "System: <name>" label is a forward-compat hook.

## Architecture

### Layer responsibilities

| Concern                      | Owner                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| Trajectory frame data        | Each `TrajectoryDataSource` (one `Trajectory` per DS)          |
| Topology / static frame data | Each `FrameDataSource` (one `Frame` per DS)                    |
| Block merge per compute step | `ModifierPipeline.compute` (phase A)                           |
| Modifier execution           | `ModifierPipeline.compute` (phase B)                           |
| `app.system.trajectory`      | Derived view: `length` from primary `TrajectoryDataSource`     |
| `app.system.frame`           | Cached `pipeline.compute(currentIndex)` result                 |
| Frame navigation events      | `app.system` (drives `currentIndex`, emits `frame-change`)     |
| File ingress + DS creation   | `core/src/io/index.ts` and `transport/rpc/router.ts`           |
| Cleanup (WASM dispose)       | Per DS: each owns its dispose closure                          |

### Class design

```ts
// core/src/pipeline/data_source_modifier.ts

export type DataSourceKind = "trajectory" | "frame";

export type SourceSpec =
  | { kind: "file"; blob: Blob; format: FileFormat }
  | { kind: "backend" }
  | { kind: "empty" };

export abstract class DataSourceModifier extends BaseModifier {
  /** "trajectory" | "frame" — discriminator */
  abstract readonly kind: DataSourceKind;

  /** Display name for UI. */
  filename: string;

  /** Provenance. */
  sourceType: "file" | "backend" | "empty";

  /** Block names this DS will contribute to the merged frame. */
  contributedBlocks: ReadonlyArray<string>;

  /** Re-load spec for delete-then-rebuild semantics (1a). */
  sourceSpec: SourceSpec | null;

  /** How many frames this DS provides. Trajectory = N, Frame = 1. */
  abstract get frameCount(): number;

  /**
   * Return the frame this DS contributes for the given trajectory index.
   * - TrajectoryDataSource: returns trajectory.frame(index)
   * - FrameDataSource: returns the single frame regardless of index
   *
   * May be async if the underlying source is streamed. Callers MUST await
   * before reading blocks.
   */
  abstract getFrame(index: number): Promise<Frame> | Frame;

  /**
   * Pre-load the frame at index into a sync cache. Called by
   * `applyPipeline` before phase A so phase A can read sync.
   */
  abstract preload(index: number): Promise<void>;

  /**
   * Sync access to the most recently preloaded frame. Throws if preload
   * was not called.
   */
  abstract get cachedFrame(): Frame;

  /** Free WASM resources (Trajectory / Frame / streaming worker). */
  abstract dispose(): void;

  /** Identity at apply time — actual block injection is phase A in compute(). */
  apply(input: Frame, _ctx: PipelineContext): Frame {
    return input;
  }
}

export class TrajectoryDataSource extends DataSourceModifier {
  readonly kind = "trajectory" as const;
  private trajectory: Trajectory;
  private _cachedFrame: Frame | null = null;

  constructor(trajectory: Trajectory, opts: { filename: string; sourceType; sourceSpec; }) { ... }

  get frameCount() { return this.trajectory.length; }

  async getFrame(i: number): Promise<Frame> {
    return this.trajectory.frame(i);  // sync or async depending on backing
  }

  async preload(i: number) {
    this._cachedFrame = await this.getFrame(i);
  }

  get cachedFrame() {
    if (!this._cachedFrame) throw new Error("preload() not called");
    return this._cachedFrame;
  }

  dispose() { this.trajectory.dispose?.(); }
}

export class FrameDataSource extends DataSourceModifier {
  readonly kind = "frame" as const;
  private frame: Frame;

  constructor(frame: Frame, opts: { ... }) { ... }

  get frameCount() { return 1; }
  getFrame(_i: number): Frame { return this.frame; }
  async preload(_i: number) { /* no-op */ }
  get cachedFrame() { return this.frame; }

  dispose() { this.frame.free?.(); }
}
```

### Pipeline two-phase execution

```ts
// core/src/pipeline/pipeline.ts (revised compute)

async compute(frameIndex: number, app: MolvisApp, changeKind = "full"): Promise<Frame> {
  // ── Pre-load: each DS resolves its frame for `frameIndex` (parallel) ──
  const dsModifiers = this.modifiers.filter(
    (m): m is DataSourceModifier => m instanceof DataSourceModifier && m.enabled
  );
  await Promise.all(dsModifiers.map((ds) => ds.preload(frameIndex)));

  // ── Phase A: build merged frame from DS contributions in array order ──
  let workingFrame = createEmptyFrame();
  for (const ds of dsModifiers) {
    const src = ds.cachedFrame;
    for (const blockName of ds.contributedBlocks) {
      const block = src.getBlock(blockName);
      if (block) {
        workingFrame.insertBlock(blockName, block);  // last wins
      }
    }
    // simbox last-wins (small object, safe to ref-share)
    if (src.simbox) workingFrame.simbox = src.simbox;
  }

  // ── Phase B: run non-DS modifiers in array order ──
  const ctx = createDefaultContext(workingFrame, app, frameIndex, changeKind);
  ctx.currentSelection = SelectionMask.all(workingFrame.getBlock("atoms")?.nrows() ?? 0);

  for (const mod of this.modifiers) {
    if (!mod.enabled || mod instanceof DataSourceModifier) continue;
    // Existing parent/selection-resolution logic preserved here unchanged
    workingFrame = mod.apply(workingFrame, ctx);
    // Existing post-apply selection cache preserved
  }

  this.emit(PipelineEvents.COMPUTED, { frame: workingFrame, context: ctx });
  return workingFrame;
}
```

**Key contract**: `DataSourceModifier.apply()` returns input unchanged.
The actual block injection lives in phase A. This keeps the modifier
interface uniform while letting DSs participate in pipeline ordering /
parent-child / enabled state.

**Key invariant**: children of a DS (by `parentId`) are still executed in
phase B at their natural array position. Children of a DS are *purely
visual grouping* — they do not gain special execution semantics.

### Frame-count validation rules

Validation happens at **load time** (when a new DS is appended), never at
compute time:

```ts
function validateAddDS(pipeline: ModifierPipeline, newDS: DataSourceModifier) {
  const trajectoryDSs = pipeline.getModifiers()
    .filter((m): m is TrajectoryDataSource => m instanceof TrajectoryDataSource);

  if (newDS instanceof TrajectoryDataSource) {
    if (trajectoryDSs.length > 0) {
      const expected = trajectoryDSs[0].frameCount;
      if (newDS.frameCount !== expected) {
        throw new FrameCountMismatchError(
          `File has ${newDS.frameCount} frames; existing trajectory has ${expected}. ` +
          `File must be single-frame (topology) or match existing frame count.`
        );
      }
    }
  }
  // FrameDataSource: no validation needed; always 1 frame, always safe to add.
}
```

Additional validations at load time:

- **Atom-count consistency**: if the new DS contributes a `bonds` block,
  every `atom_index` in `bonds.i` / `bonds.j` must be `< atom_count` of
  the existing system (computed from the *current* merged frame).
- **Block-type consistency**: if both old and new DS provide `atoms`, the
  atom counts must match (otherwise downstream bonds become dangling).

Both fail-fast with concrete error messages.

## Load decision tree

`io/loadFileContent` and `io/loadFileStream` both reduce to:

```
load(file F, N_file = F.frame_count):

  existingTrajDSs = pipeline.filter(TrajectoryDataSource)

  if existingTrajDSs.length === 0:
    if N_file === 1:
      → create FrameDataSource(F.frame[0])
    else:
      → create TrajectoryDataSource(F)
  else:
    existing_N = existingTrajDSs[0].frameCount
    if N_file === 1:
      → create FrameDataSource(F.frame[0])
    elif N_file === existing_N:
      → create TrajectoryDataSource(F)
    else:
      → error FrameCountMismatchError

  validateAtomCount(newDS, currentMergedFrame)
  pipeline.addModifier(newDS)
  applyAutoAttach(pipeline, newDS)   // attach DrawAtom/DrawBond/DrawBox as children
  applyPipeline()
```

**No "promote 1→N" branch needed.** When user loads topology first
(state → `{F}`, system 1-frame) then trajectory (state → `{F, T}`, system
N-frames), the existing `FrameDataSource`'s `getFrame(_i)` already
broadcasts naturally.

## Lifecycle: removing a DS (1a semantics)

Removing any DS triggers a full pipeline rebuild from the remaining DSs:

```
removeDataSource(dsId):
  removed = pipeline.removeModifier(dsId)        // existing API; cascades children
  removed.forEach((m) => m instanceof DataSourceModifier && m.dispose())

  // Re-derive system trajectory length from remaining DSs
  if (no TrajectoryDataSource left):
    system.frameCount = (any FrameDataSource left ? 1 : 0)
    system.currentIndex = 0
  else:
    system.frameCount = remaining TrajectoryDS[0].frameCount
    system.currentIndex = min(currentIndex, system.frameCount - 1)

  applyPipeline()                                 // re-run phase A from scratch
```

**Streaming caveat**: if a remaining DS is a streaming `TrajectoryDataSource`
its WASM index is preserved (no re-streaming). The rebuild is just
phase-A re-walk. Removing the streaming DS itself triggers worker close +
OPFS handle release.

If the user removes a non-streaming DS while a streaming DS remains, no
re-streaming happens — only the merge re-runs. This is cheap.

If the user removes a streaming DS, the worker closes; remaining DSs
continue to function unchanged.

## API changes

### Core (`@molvis/core`)

| Symbol | Change |
| --- | --- |
| `DataSourceModifier` | Becomes `abstract`. Add `kind`, `frameCount`, `getFrame`, `preload`, `cachedFrame`, `dispose`, `sourceSpec`, `contributedBlocks` |
| `TrajectoryDataSource` | New class |
| `FrameDataSource` | New class |
| `MolvisApp.setTrajectory(traj)` | Wraps in `TrajectoryDataSource`, replaces all DSs |
| `MolvisApp.addDataSource(spec)` | New: append-mode, runs decision tree |
| `MolvisApp.removeDataSource(dsId)` | New: cascade dispose + rebuild |
| `MolvisApp.applyPipeline()` | Removes external `sourceFrame` arg; pipeline gets data from DSs |
| `ModifierPipeline.compute(frameIndex, app, changeKind)` | No longer takes `FrameSource` |
| `FrameSource` interface | **Deleted** — superseded by DS-owned data |
| `ArrayFrameSource` | **Deleted** |

### RPC (`transport/rpc/router.ts`)

New verbs:

```
scene.add_data_source(payload)         // append-mode load
scene.remove_data_source({ id })       // remove + rebuild
scene.list_data_sources()              // for debugging / state-sync
```

Existing verbs preserve replace-all semantics (legacy):

```
scene.draw_frame(payload)              // → wrap as FrameDataSource, replace all
scene.set_trajectory(payload)          // → wrap as TrajectoryDataSource, replace all
scene.new_frame()                      // → empty FrameDataSource, replace all
```

`pipeline.available_modifiers` does **not** list `TrajectoryDataSource` /
`FrameDataSource` — DSs are only created via file ingress.

### Page (`page/`)

- `DataSourceModifier.tsx` panel split: distinct UI for `TrajectoryDataSource`
  vs `FrameDataSource` (badge color, frame count display).
- Sidebar adds **"Add Data Source"** button; opens existing format picker.
  Drag-drop also routes to append mode if a system is already loaded.
- "Open File" (replace) and "Add Data Source" (append) are distinct entry
  points — clear visual separation in the UI.
- Pipeline tree shows DS expansion: children Draw modifiers visually nested
  under their DS parent.
- Status pill on each DS: `Trajectory · 1000 frames` /
  `Topology · 1 frame (broadcast)` / `Topology · 1 frame`.

## State transitions reference

| Event                                  | DS state     | system.frameCount | currentIndex     |
| -------------------------------------- | ------------ | ----------------- | ---------------- |
| init / `reset()`                       | ∅            | 0 (or 1 empty)    | 0                |
| Load 1-frame file (from ∅)             | {F}          | 1                 | 0                |
| Load N-frame file (from ∅)             | {T}          | N                 | 0                |
| Load 1-frame file (from {T(N)})        | {T, F}       | N                 | unchanged        |
| Load N-frame file (from {T(N)})        | {T₁, T₂}     | N                 | unchanged        |
| Load M-frame file (from {T(N)}, M≠N,1) | {T(N)}       | N                 | unchanged + ERR  |
| Load N-frame file (from {F})           | {F, T}       | N                 | 0 (system grew)  |
| Remove T from {T, F}                   | {F}          | 1                 | 0                |
| Remove last DS                         | ∅            | 0                 | 0                |
| Edit add/remove atom                   | unchanged    | unchanged         | unchanged        |

## Edge case decisions

| Case | Decision |
| --- | --- |
| Empty pipeline allowed?                | Yes. UI shows empty state. `app.system.frame` is null. |
| Mix N≠M trajectories at load time      | Throw `FrameCountMismatchError` with concrete numbers. |
| All DSs disabled                       | Pipeline computes empty frame; UI shows empty scene + warning pill. |
| Edit while only `FrameDataSource` exists | Edits target the `FrameDataSource.frame`. |
| Edit while no DS exists                | Edit mode disabled (cannot enter). |
| Remove DS while in Edit mode           | Abort Edit mode, discard pending edits. Show toast. |
| Streaming TrajectoryDS + remove other DS | Only phase-A re-runs; no re-streaming. |
| Last-wins block conflict                | Silent overwrite. UI shows on the receiving DS card: "atoms (overrides DS-α)" tooltip. |
| Block contributions come from disabled DS | `enabled === false` → DS skipped in phase A. |
| Frame.simbox conflict                  | Last DS that has `simbox` wins (same as block last-wins). |

## molrs memory model (verified phase 0)

`Frame.insertBlock(name, block)` calls into `Block::clone_block()`
(`molrs-wasm/src/core/frame.rs:187`). Implementation chain:

- `Block` is `#[derive(Clone)]` over `HashMap<String, Column>`
  (`molrs-core/src/block/mod.rs:52`).
- `Column` is an enum of `Arc<ColumnHolder<T>>` variants
  (`molrs-core/src/block/column.rs:84`).
- Each variant's mutable accessor uses `realize_owned_mut(arc)` →
  `Arc::make_mut(arc)` (`molrs-core/src/block/column.rs:183`).

**Consequence**: `insertBlock` is O(num_columns) Arc bumps, NOT O(N_atoms)
memcpy. Multiple frames share column data through `Arc<ColumnHolder<T>>`.
Mutation goes through `Arc::make_mut`, which clones only when refcount > 1
(canonical Rust copy-on-write).

This means the multi-DS merge in phase A is essentially free at the data
plane:

- Each pipeline `compute()` builds a fresh merged `Frame` and inserts each
  contributing block as an Arc bump. Memory cost ≈ O(num_DS × num_blocks).
- Phase B modifiers (Hide / Color / Slice / etc.) that mutate columns
  trigger CoW automatically; source DS data is preserved.
- Static topology broadcast (`FrameDataSource` reused for 1000-frame
  trajectory) costs nothing extra at runtime — every `compute()` re-inserts
  the same Arc.

**No additional clone or COW logic at the MolVis layer**. This was the
biggest implementation unknown coming into phase 1; resolved.

## Phase plan

### Phase 0: molrs memory-model verification (DONE)

- [x] Verified `Frame.insertBlock` is Arc-based; share with CoW
- [x] No explicit clone-Frame step needed at MolVis layer
- [x] Static-topology broadcast is O(1) per compute step (no materialization)

### Phase 1: core data plane (3–5 days)

- [ ] `DataSourceModifier` becomes abstract; add `kind`, `frameCount`, `getFrame`, `preload`, `cachedFrame`, `dispose`
- [ ] Implement `TrajectoryDataSource`, `FrameDataSource`
- [ ] Two-phase `ModifierPipeline.compute`
- [ ] Remove `FrameSource` / `ArrayFrameSource`; update callers
- [ ] `MolvisApp.addDataSource` / `removeDataSource` + lifecycle
- [ ] `MolvisApp.system.trajectory` becomes derived view
- [ ] Load-time validation: frame count, atom count, block type consistency
- [ ] Tests: every state-transition row in the table above

### Phase 2: parent-child + auto-attach (2 days)

- [ ] `pipeline.setParent` accepts `DataSourceModifier` as parent without
      requiring child `ConsumesSelection` capability
- [ ] `auto_attach` attaches `DrawAtom` / `DrawBond` / `DrawBox` as
      children of the DS that contributed `atoms` / `bonds` / `simbox`
- [ ] Pipeline visualization: children nested under DS in UI tree

### Phase 3: UI + ingress (3 days)

- [ ] "Add Data Source" button on sidebar + drag-drop branch detection
- [ ] DS panel rewrite: distinct trajectory vs frame UI; status badges
- [ ] Frame-count mismatch dialog → user-facing error UI
- [ ] Per-DS remove confirm (with streaming caveat warning)

### Phase 4: RPC + state sync (2 days)

- [ ] New verbs: `scene.add_data_source`, `scene.remove_data_source`,
      `scene.list_data_sources`
- [ ] Legacy verbs (`scene.draw_frame`, `scene.set_trajectory`) → wrap
      and replace
- [ ] `state_sync.ts` round-trips DS list (kind, filename, sourceType,
      contributedBlocks)
- [ ] On session restore, DSs come back as `sourceType: "empty"`
      placeholders; user re-loads files

### Phase 5: streaming integration sweep (1 day)

- [ ] `loadFileStream` → append-mode path produces `TrajectoryDataSource`
      backed by streaming `Trajectory.fromAsyncProvider`
- [ ] Verify worker disposal on DS removal
- [ ] Verify OPFS index sidecar lifecycle per DS

## Open questions for implementation

- ~~**molrs `Frame.insertBlock` semantics**~~ Resolved in phase 0:
  Arc-share with `Arc::make_mut` CoW. No MolVis-layer cloning needed.
- **Backend RPC migration** for existing Python code: do we keep
  `scene.draw_frame` indefinitely, or deprecate after one minor version?
  Suggested: keep indefinitely, document as legacy.
- **State sync round-trip fidelity**: cannot persist `Trajectory` across
  session reloads; placeholder DS strategy is acceptable but UX
  ("re-attach this file") needs design polish in phase 4.

## Migration / breaking changes

- `pipeline.compute()` API loses its `FrameSource` argument. All
  internal callers (`app.applyPipeline`, command-system routes) must be
  updated. No external callers exist (verified by grep at spec time).
- `app.setTrajectory(traj)` keeps the same signature but internally
  routes through DS replacement.
- Page UI: drag-drop on a non-empty system now appends instead of
  replaces. Replace remains accessible via "New" / explicit Open File.

## References

- OVITO `FileSource` and `LoadTrajectoryModifier` documentation
  (`https://www.ovito.org/manual/reference/file_formats/input/lammps_dump_local.html`)
- OVITO `CombineDatasetsModifier` (relevant non-goal: atom-set
  extension)
- VMD `mol new` / `mol addfile` workflow (precedent for symmetric load
  order)
- Existing MolVis specs:
  - `docs/specs/streaming-trajectory.md` (worker lifecycle pattern,
    referenced for streaming DS dispose)
  - `docs/specs/dataset-explorer.md` (UI sidebar conventions)
- Memory: `project_streaming_worker_lessons.md`,
  `project_streaming_trajectory_cache.md`
