# Multi-Source Pipeline

This is the current MolVis multi-source design. It intentionally does not
preserve the removed multi-source composition API.

## Load Modes

`LoadMode` has three explicit values:

- `replace`: clear the current pipeline and install the loaded trajectory as the
  only `FileDataSource`.
- `augment`: add the loaded trajectory as another data source. Runtime source
  composition overlays compatible blocks across the same logical atom set.
- `extend`: concatenate atom sets at load time, offset bond indices, write an
  integer `source_id` atom column, and replace the scene with the extended
  trajectory.

There is no `auto` mode. Callers must choose the behavior they want.

## Runtime Augment

Runtime multi-source composition is augment-only.

Each enabled `DataSourceModifier` contributes a trajectory to
`composeSources`. Composition rules:

- Single-frame sources broadcast across the active timeline.
- Multi-frame sources must share the same frame count.
- Block names are unioned into a composed frame.
- Multiple `atoms` blocks must have the same atom count.
- Block filters on a data source restrict which blocks it contributes.

Data sources remain modifiers so the UI can list, enable, disable, and order
them, but `DataSourceModifier.apply()` is identity. Composition happens before
ordinary modifiers run.

## Loader-Time Extend

`extend` is not a runtime graph operation. The loader builds a new trajectory by
materializing frames from the currently enabled sources plus the incoming file.

For every frame:

- `atoms` rows are concatenated.
- `bonds.atomi` and `bonds.atomj` are offset by each source's atom offset.
- `atoms.source_id` records the source ordinal.
- Other block types are not concatenated by `extend`; use `augment` for
  auxiliary blocks that share the same logical atom set.

The result is installed through `replaceScene`, so downstream pipeline state is
not implicitly preserved across incompatible atom-id spaces.

## Ownership And Selection Scope

The old single parent field is split:

- `sourceOwnerId`: visual tree ownership under a data source. It affects UI
  grouping and cascade removal only.
- `selectionScopeId`: the selection-producing modifier consumed by a
  selection-scoped modifier.

This separation keeps execution semantics explicit. A modifier can be displayed
under a data source without consuming that source's selection, and a modifier can
consume a selection without being a tree child of the producer.

## UI

The pipeline UI is a tree:

- Data sources are top-level nodes.
- Source-owned modifiers are nested under their `sourceOwnerId`.
- Non-owned modifiers remain top-level.
- Modifier rows show a colored rail for selection scope. Producers use their own
  stable color; consumers use the color of `selectionScopeId`.

File loading is explicit:

- `File loader` is the Add-menu file ingress.
- Loading into a non-empty scene asks whether to replace or add.
- `Extend` is a Data Loader property.

## Selection Storage

Selection state stores logical numeric atom and bond ids:

```ts
interface SelectionState {
  atoms: Set<number>;
  bonds: Set<number>;
  revision: number;
}
```

Render keys are accepted at the boundary and resolved once through
`SceneIndex`. Internally, selection diffing and highlighter updates operate on
numeric ids to avoid long-lived string-key sets and repeated parse work.

`SelectionMask` uses `Uint8Array`, not `boolean[]`, for dense per-frame masks.
This is predictable in memory and faster to scan/copy for modifier pipelines.

Expression selection returns logical atom ids directly from `SceneIndex`
metadata. It does not require render keys or mesh registration.

## Tests

The test surface is intentionally orthogonal:

- `source_composition.test.ts`: runtime augment and loader-time extend.
- `pipeline_scope.test.ts`: `selectionScopeId` vs `sourceOwnerId`.
- `selection_manager.test.ts`: logical-id state and render-key boundary.
- `pipeline_tree_utils.test.ts`: UI tree grouping.

Removed multi-source, auto-merge, broad DAG, and e2e-style tests were deleted.
