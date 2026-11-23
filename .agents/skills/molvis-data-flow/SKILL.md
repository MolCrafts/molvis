---
name: molvis-data-flow
description: Maintain MolVis source ingestion, trajectory streaming, mrec readers, byte-range transports, periodic coordinates, and WASM object ownership. Use when changing loaders, DataSources, frame composition, workers, or MolRS handles.
---

# MolVis data flow

## Scene ingress and identity

- Use `DataSource` subclasses to convert sources into `Trajectory`/`Frame`, then
  compose → transform → draw. GUI and RPC loading use this same pipeline.
  HTTP and SSH are host transports, not DataSource kinds or MolRS concepts.
- Open/reset starts with an empty pipeline and a length-one
  `System.trajectory`; zero-source composition produces an empty Frame.
  Adding files to a loaded scene composes sources rather than silently replacing
  existing data. STL is a mesh overlay via `loadMeshOverlay`, not an atom source.
- Preserve MolRS atom `id` values at the boundary, including masks and bond
  endpoints. IDs are not row indices. Build render-row maps at apply time and
  reject unknown IDs. WASM ID columns use `BigUint64Array`; GPU indices and CSR
  maps use `Uint32Array`.
- Use `DType` from `stage/src/utils/dtype.ts` for column dispatch. Preserve
  concrete storage widths, domain IDs, and metadata rather than guessing types.
- Keep derived transforms immutable. For WASM ownership, read
  [MolRS handles](references/molrs-handles.md) before changing object lifetime.

## Readers and transports

MolRS owns format scanning, frame indexes, and one-frame decode. Hosts supply
bytes; `.molidx` only caches the byte offsets and lengths emitted by MolRS.
Do not build host-side format scanners. Read [streaming contracts](references/streaming.md) for mrec,
worker transfers, sidecars, and VS Code restrictions.

The source map starts at `stage/src/io/index.ts`, `stage/src/io/reader.ts`,
`stage/src/io/zarr.ts`, `stage/src/system/source_composition.ts`, and
`stage/src/transport/trajectory_worker/`. Reuse these paths instead of adding a
parallel ingress or decoder.

## Coordinate policy

- After composition, `applyWrapIfEnabled` in `stage/src/coords/wrap.ts` is the
  single atom-coordinate wrapping gate controlled by `wrapEnabled`.
- Only atom columns are wrapped with `Box.wrap`. Bond and ribbon continuity
  uses draw-time minimum-image `Box.delta`; do not rewrite atom columns again.
- Molecular surface fields default to atom AABB plus padding, nonperiodic, so
  surfaces follow the displayed molecule. Explicit bulk `domain: "cell"` uses
  the periodic orthorhombic frame box. Native CUBE/CHGCAR grids retain their
  file box and periodic meshing policy; atom wrapping does not rewrite grids.
- Auto-attach default visuals via `matches`; opt-in analysis uses applicability
  menus. Do not make analysis silently replace element colors or representations.

Preserve the rendering pass's `changeKind` when data changes; see
[molvis-rendering](../molvis-rendering/SKILL.md).
