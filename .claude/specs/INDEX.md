# Specs Index

Active runtime specs. `/mol:spec` adds an entry here; `/mol:impl` ticks the
spec's tasks off and prunes the entry (and file) on completion.

## Open

| Spec | Priority | Summary |
|------|----------|---------|
| [app-abstraction-sink](app-abstraction-sink.md) | P0 | Sink engine-neutral App into core; stage + sketch Apps; plugin facade |
| [optimize-worker-ship](optimize-worker-ship.md) | P0 | Ship structure optimize fully on shared compute workload worker |
| [workload-analysis-jobs](workload-analysis-jobs.md) | P0 | Heavy Compute analyses on same workload worker (cancel/progress) |
| [coordinate-frame-policy](coordinate-frame-policy.md) | P1 | Single post-compose coordinate policy for all Draws / MI |
| [compute-partial-first-class](compute-partial-first-class.md) | P1 | Rings / series / bond distributions as first-class Compute UX |
| [compute-form-design-acceptance](compute-form-design-acceptance.md) | P1 | All Compute panels meet form anatomy + naming policy |
| [structure-id-boundary](structure-id-boundary.md) | P1 | Document/enforce structure-ID shipped vs oos boundary |

**Suggested impl order:** `optimize-worker-ship` → `workload-analysis-jobs` →
`app-abstraction-sink` (or parallel if free) → `coordinate-frame-policy` →
compute pair → structure-id.

## Shipped batches

### 2026-08-10 — P2 product pack

- **vsc-sketch-quick-view** — Sketch Quick View command + MOL V2000 peek host
- **multi-datasource-compose** — Replace/Add source UI, Primary badge, pipeline docs
- **ui-data-inspector-touch** — coarse 44px row height + shared virtualizer token
- **ui-empty-states** — short title-only empties for pipeline + atom/bond tables
- **ui-resize-coalesce** — rAF-coalesced ResizeObserver on stage container

### 2026-07-31 — close backlog + product polish

- **scene-modifier-iron-law** — closed (A6 agent-auto: analyses stay left catalog)
- **stage-commit-scene** — closed (criteria verified)
- **package-split-core-stage** — closed
- **shared-element-picker-01..04** — closed

### 2026-07-30 — OVITO parity matrix

- **ovito-parity-01-matrix** — full OVITO↔MolVis gap matrix (no Python/Voronoi) + inventory test
- **ovito-parity-02-replicate-unwrap** — P0 Replicate + Unwrap trajectories
- **ovito-parity-03-compute-freeze** — Compute property + Freeze property
- **ovito-parity-04-edit-types-overlap** — Edit types + Select overlapping
- **ovito-parity-05-displacement** — Displacement vectors columns
- **ovito-parity-06-viz-p1b** — Coordination polyhedra, trajectory lines, construct surface mesh
- **ovito-parity-07-p2** — Smooth trajectory, SSAO settings, Edit lattice UX

### 2026-07-30 — OVITO Selection parity

- **ovito-modifier-align** — Clear / Invert / Select Type / Expand Selection (+ registry, regression)

### 2026-07-29 — molvis-sketch chain

- **molvis-sketch-01-model** — `@molcrafts/molvis-sketch` graph, history, Frame IO
- **molvis-sketch-02-canvas** — native Canvas SketchBoard + tools
- **molvis-sketch-03-ops** — ChemDraw-level ops (rings, stereo, charge, keymap)
- **molvis-sketch-04-page** — page Builder replaces Kekule with MolvisSketch

### 2026-07-24 — quality + structure

- select-modifier-expression
- trajectory-play-prefetch
- core-app-scene-facade

### 2026-07-24 — roadmap four

- **camera keyframe interpolate** — `KeyframeTrack` + Catmull-Rom / slerp
- **RPC schema single-source** — `RPC_METHODS` / `RPC_PROTOCOL_VERSION` + `rpc.list_methods`
- **artist representation split** — `artist/representation_draw.ts` host/delegate
- **VSCode Structure Outline + Explorer load** — `molvis.outline` tree, `loadInWorkspace`, auto-load when workspace open
