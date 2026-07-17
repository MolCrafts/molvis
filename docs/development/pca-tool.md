# PCA dataset explorer

The **PCA** tool projects per-frame numeric properties to a 2D scatter you
can click to navigate the trajectory — a chemiscope-style "map of property
space". It lives in the LeftSidebar analysis dropdown alongside *Radial
distribution g(r)* and *Cluster analysis*.

The guiding principle: **MolVis visualizes what the file provides.** The tool
is not a feature-engineering surface — if a dataset carries no per-frame
properties, the tool shows an empty state pointing back at the loader.

## What counts as a descriptor

Descriptors come from **`frame.meta`** — the `key=value` pairs on each frame.
For Extended XYZ (ExtXYZ) trajectories these are the comment-line properties:

```text
3
energy=-1.234 temp=300.0 Lattice="..." Connct="[0,1,0,2]"
C 0.000 0.000 0.000
...
```

Every key whose value parses to a finite number on at least one frame becomes
a candidate descriptor. Purely categorical keys (`config=trans`) are dropped.
Non-XYZ formats (LAMMPS, PDB) expose no `frame.meta`, so the tool shows the
empty state for them.

Labels are aggregated **once at load time** into `system.frameLabels`
(a `Map<string, Float64Array>`), so the UI never walks frame metadata itself.
Lazy/streaming trajectories skip aggregation to preserve on-demand loading.

## Workflow

1. Load an ExtXYZ trajectory with per-frame properties.
2. Open the LeftSidebar and pick **PCA** from the analysis dropdown.
3. **Descriptors** — every numeric label is pre-ticked; uncheck any you want
   to exclude (PCA needs ≥ 2 descriptors and ≥ 3 frames).
4. **Clustering** — optionally enable k-means (`k` in 2–20, fixed seed) to
   color points by cluster.
5. **Color** — color points by cluster, a chosen label, frame index, or solid.
6. **Compute** — runs PCA (+ optional k-means) in molrs/WASM and renders the
   scatter.

From the map:

- **Click a point** → the 3D canvas and timeline seek to that frame.
- **Hover** → tooltip with the frame index and PC coordinates.
- **Scrub the timeline** → the current-frame highlight ring tracks along the
  map (rAF-coalesced).

The exploration result is preserved on `system.exploration` until the
trajectory changes, so switching the dropdown away and back keeps the map.

## Under the hood

| Layer | Piece |
|-------|-------|
| WASM | `WasmPca2`, `WasmKMeans`, `frame.getMetaScalar`/`metaNames` (molrs) |
| Loader | `aggregateFrameLabels(trajectory)` → `system.frameLabels` |
| Orchestrator | `runExploration(frameLabels, config)` → `DatasetExploration` |
| State | `System.frameLabels` / `System.exploration` (+ matching events) |
| UI | `PCATool.tsx` (LeftSidebar panel), `@molcrafts/molplot` `ScatterChart` (standalone repo, Vega-Lite) |

`runExploration` stacks the selected label columns into a row-major matrix and
hands it to molrs; it rejects any column containing a non-finite value with a
precise error so the Compute button can surface it. See the TSDoc on
`runExploration`, `ExplorationConfig`, and `DatasetExploration` for the full
contract.

## Scope (MVP)

In: ExtXYZ frame-label descriptors, PCA, k-means color overlay, click-to-seek.
Out (deferred): computed geometry descriptors (Rg, RMSD, …), atom-column
reducers, CSV/JSON descriptor upload, t-SNE/UMAP, lasso/box multi-select,
3D maps, and descriptor extraction for non-XYZ formats.
