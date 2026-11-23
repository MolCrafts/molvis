# Canvas identity and SceneIndex

Canvas interaction resolves what is actually drawn. A selected ID missing from
SceneIndex is an error; do not substitute a similarly numbered HEAD row.

| Layer | Truth | Uses |
|---|---|---|
| Canvas | SceneIndex meta/mesh registries | Pick, hover, fence, drag, measure, highlight |
| Live selection | SceneIndex logical IDs in SelectionManager | Click, fence, live expressions, selected meta |
| Pipeline | Composed Frame and `selectionSet` masks | Select/Hide/Color/Delete modifiers, analysis |
| Reverse lookup/export | Scene ID → Frame row, or materialized scene | Residue columns, selected export, saving edits |

## Selection and export

- Canvas pick/fence updates live SelectionManager immediately and persists
  the active manual producer through `writeLiveSelectionToActive`.
- Pipeline producers write `selectionSet`; they do not overwrite live selection
  arbitrarily. A full rebuild projects the active producer using
  `syncHighlightFromActive`. Returning to Select restores its highlight.
- Pushing live selection into the pipeline saves a dirty scene first
  (`confirmPendingSelection` → `commitScene`), remaps IDs through dense
  reindexing, then creates the selection modifier.
- Dirty or out-of-HEAD selected exports materialize from SceneIndex with ID
  remaps. A clean dense HEAD can use its Frame to retain extra columns.
- Anchored overlays follow SceneIndex positions. Residue labels and ribbon
  expansion may read Frame columns only for IDs present on the canvas.
- `selectFromFrame` is a pipeline expression API; live `selectByExpression`
  evaluates against SceneIndex. Keep those contracts distinct.
- `commitScene` remaps live atom and bond selection through
  `materializeFrameFromScene` maps before clearing the edit pool.

## Editing and topology

- Entering Edit promotes render indices only. Retain frame-backed metadata;
  edits overlay it lazily. `AtomSource.deleted` and `BondSource.deleted` are
  tombstones so deleted frame entities cannot reappear on the next save.
- Never eagerly clone all entity metadata merely to enter Edit mode.
- Topology belongs to the whole rebuild pass. Layer registration may add
  vertices/edges but never clear the graph. Use the pass's `changeKind` for
  topology-dependent caches.
- Keyboard routing in `BaseMode` uses document keydown gated by canvas
  `:hover` or focus. A pointerenter flag alone misses a pointer already over
  the canvas when the mode mounts.

Compute results that describe a displayed pipeline visualization must consume
that same result. Do not run a second independent clustering for the panel
while drawing the first clustering on the canvas.
