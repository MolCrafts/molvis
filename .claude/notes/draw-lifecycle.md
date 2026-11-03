<!-- mol:note:topic:draw-lifecycle -->
## [2026-09-23] Draw lifecycle — one pass, four contracts

End-to-end map of how a frame reaches the GPU, and the rules that keep the
layers from depending on each other's execution order. Written after a bug
where every bond stick vanished: the bond layer sampled the atom layer's
registered color buffer, which held the *previous* pass's contents.

### The pass

```
host action (GUI / RPC / playback / stream / style change)
  → MolvisApp.applyPipeline({ fullRebuild | changeKind | composed })      stage/src/app.ts
      ├ changeKind ← resolvePipelineChangeKind(options)
      ├ full: highlighter.discardSavedOriginals(); sceneIndex.topology.clear()
      ├ ModifierPipeline.compute(frameIndex, app, changeKind, precomposed)  pipeline/pipeline.ts
      │    ├ Phase A  composeHead(): composeSources(sources) → applyWrapIfEnabled
      │    └ Phase B  executionOrder(modifiers) — stable topo sort over
      │                `selectionScopeId` edges, then capability bands
      │         per modifier: currentSelection ← scope mask | all(atomCount)
      │                       validate(frame, ctx) → frame = await apply(frame, ctx)
      │                       selection producer → ctx.selectionCache.set(id, mask)
      │         emit COMPUTED { frame, context }
      ├ Artist.applySceneIndexToMeshes()      ← the pass's only GPU upload
      ├ per modifier: modifier.applyVisibility(app, enabled)
      ├ artist.applySliceMaskIfPresent(frame)
      ├ no edit overlay → sceneIndex.markAllSaved()
      ├ emit "frame-rendered" { frame, box, changeKind }
      └ full: syncHighlightFromActive(frame); highlighter.invalidateAndRebuild()
              then ctx.postRenderEffects, in registration order
```

### The four contracts

1. **Topology lifetime belongs to the pass.** `applyPipeline` clears
   `SceneIndex.topology` once, before any Draw runs; layers only append
   (`registerAtomFrame` → atoms, `registerBondFrame` → bonds). No
   `register*Frame` may clear it: Bonds auto-attaches *ahead of* Particles, so
   whichever layer cleared would wipe the half that registered first and every
   `getBondsForAtom` / `incident` answer goes empty.

2. **`changeKind` is carried, never re-derived.** `system/frame_diff.ts`
   classifies the incoming frame against `_lastRenderedFrame` and threads the
   verdict into `PipelineContext`. A `"position"` pass is buffer-update only:
   it may not `registerFrame`, recreate `ImpostorState`, or recompute colors.
   Consumers that cache per topology must read the verdict — a row-count
   comparison cannot see an equal-count topology swap.

3. **A draw layer reads its inputs.** Its inputs are the frame (blocks, box)
   plus `StyleManager` — never a sibling layer's GPU state, and never a buffer
   that belongs to another pass. Layer order then decides nothing about what is
   painted, which is why the layer order below is safe.

4. **`Artist.applySceneIndexToMeshes` is the pass's only upload.** Draws write
   `ImpostorState.buffers` and mark them dirty; the upload walks dirty buffers
   only (the position path ships `instanceData` alone). `applyVisibility` runs
   *after* it, because it unconditionally `setEnabled(true)`s any layer holding
   data — running it earlier would undo a user's uncheck.

### Draw layers and their order

Draw-capability modifiers run in band 6 of `executionOrder`
(`pipeline/pipeline.ts:bandPriority`). Auto-attach order is registry order
(`pipeline/modifier_registry.ts`), which puts **Bonds before Particles**:

| Layer | Modifier | `"position"` path | `"full"` path |
| --- | --- | --- | --- |
| Bonds | `DrawBondModifier` | `refreshBondPositions` | `artist.drawBonds` → `drawBondsRepresentation` |
| Simulation cell | `DrawBoxModifier` | — | `artist.drawBox` |
| Particles | `DrawAtomModifier` | `refreshAtomPositions` | `artist.drawAtoms` → `drawAtomsRepresentation` |
| Cartoon / Isosurface / mesh overlay / volume cloud | own producer + draw | — | renderer's own `syncFromFrame` / producer parts |

Bonds-before-Particles is registry order, not a dependency. Nothing may rely on
it in either direction.

### Shader compilation is the only real await

`Artist.ensureShadersForVisibleGeometry(targets)` (a) calls `world.renderOnce()`
when a visible target still needs a warm-up render, so Babylon binds the
material and starts compiling, then (b) awaits `compileShaderMaterial` on a
throwaway 1×1 plane. Until that resolves the layer's buffers cannot be uploaded
(`applySceneIndexToMeshes` would find a null state and disable the mesh), which
is why the draw modifiers `await artist.drawAtoms / drawBonds`.

### Where async does and does not pay

- **Composer path** (`Artist.drawFrame`, one-shot full frame): the atom and bond
  layers are independent — each resolves its own buffers and colors, and both
  only append to the pass-owned topology — so they run under one `Promise.all`
  and their two shader compiles overlap instead of serialising.
- **Pipeline path stays sequential.** `ModifierPipeline.compute` awaits each
  modifier in order, because that order is the semantics (selection-scope edges
  plus capability bands). Concurrent draw layers would need a proof that the
  batch has no inter-layer ordering — true today only for the composer path.
- **Buffer building is a synchronous CPU loop** (`buildAtomBuffers`,
  `buildBondBuffers`, `buildAtomColorOnly`). There is no honest way to make it
  async on one JS thread: deferring the loop to a microtask delays the same
  upload and overlaps nothing. Real parallelism means a Worker, which needs
  ownership rules for molrs blocks and Babylon buffers — a separate project.
- **Trajectory renders coalesce** already (`FrameRenderScheduler`, latest-wins
  with a `forceFull` upgrade), so scrubbing never stacks redraws.

### Entry points

| Entry | Route |
| --- | --- |
| Open file / add source / stream append | `SceneSession.replaceScene` / `addDataSource` / `appendFrame` → `applyPipeline({fullRebuild})` |
| Scrub / play trajectory | `queueTrajectoryFrameRender` → `FrameRenderScheduler` → `renderActiveTrajectoryFrame` → `classifyFrameTransition` → `applyPipeline({changeKind, composed})` |
| Theme / representation / outline / entry toggle | `setTheme`, `setRepresentation`, `setEntryEnabled`, … → `applyPipeline({fullRebuild})` |
| Commit / discard edits | `commitScene` / `discardScene` → `applyPipeline({changeKind:"full"})` |
| RPC single stamp | `PlaceMoleculeCommand` (edit pool) — deliberately *not* a pipeline run |
| One-shot whole frame | `Artist.drawFrame` (composer; `redrawRepresentation` is its only caller) |

### The bug this map came from

`peo_helix.data` rendered with most bonds invisible while OVITO showed them.
Geometry was correct (254/254 bonds: centre = midpoint, |dir| = 1, error ~1e-6).
The endpoint colors were not: `Artist.registerRuntimeLayers` creates both
`ImpostorState`s at capacity 64 before any frame lands in them, and Bonds draws
first, so the bond pass read the previous pass's atom colors — alpha 0 across
the zeroed capacity (the fragment shader's `discard`) and `undefined` past its
end (NaN alpha, which no blend resolves into a visible stick). First-pass alpha
histograms were `{"0":149,"NaN":105}` / `{"0":63,"NaN":191}`, matching
`endpoint < 64 ⇒ 0`, `≥ 64 ⇒ NaN`.

An interim fix scoped the read to "the atom layer registered this frame in this
pass" (`Artist.beginPass` + a host callback). That was deleted: the handshake
made the mistake a probability instead of an impossibility, and its length test
could not tell an equal-length rebuild from the same pass. The live rule is
contract 3 above — the bond layer computes endpoint colors from the frame block
and the style manager (`buildAtomColorOnly`), and the regression test hands it a
poisoned atom buffer so any reintroduced read fails.

Confirmed end to end in the browser against the built page bundle: the fixture
deep-linked through the page's own `?url=` ingress, one `"full"` pass, 254/254
bond instances with alpha exactly 1 and no non-finite endpoint color on either
split buffer, and the sticks contribute 4,754 painted pixels that disappear when
the bond mesh is hidden and return exactly when it is restored. The probe recipe:
serve `page/dist`, serve a copy of `index.html` with `#root` renamed so the
bundle does not auto-mount, then call `window.MolvisApp.mount(el, { onAppChange })`
to hold the live app and read `sceneIndex.meshRegistry` states.
