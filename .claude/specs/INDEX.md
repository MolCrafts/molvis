# Specs Index

Active runtime specs. `/mol:spec` adds an entry here; `/mol:impl` ticks the
spec's tasks off and prunes the entry (and file) on completion.

## Open

- [optimize-staging-01-positions](optimize-staging-01-positions.md) — Extract the id-mapped edit-pool position writer + one-tick paint recipe out of ManipulateMode into unit-testable stage units [approved]
- [optimize-staging-02-columns](optimize-staging-02-columns.md) — Carry source-frame atom columns (charge / mol_id / residue) through materializeFrameFromScene so commit stops dropping them [approved]
- [optimize-staging-03-command](optimize-staging-03-command.md) — Land the optimize result in the edit pool as one undoable command; delete the direct-to-HEAD publish path; scene goes dirty until Ctrl+S [approved]
- [optimize-staging-04-live](optimize-staging-04-live.md) — Stream intermediate coordinates from the optimize worker and paint them position-only into the edit pool, so the molecule visibly relaxes [approved]
- [optimize-staging-05-panel](optimize-staging-05-panel.md) — Invert the optimize panel copy for the staged-result world and prove the progress bar bites on both kernel paths [approved]


## Shipped (recent)

| Batch | Specs |
|-------|--------|
| 2026-08-14 theme | **theme-tab10-ovito-01..07** — Tab10/OVITO strategies, Cartoon SS colors, solid-liquid hex, page + Python, prune Classic/Vivid |
| 2026-08-11 follow-on | **series-compute-ux** (catalog series first-class), **post-policy-draw-mi** (wrap locality) |
| 2026-08-11 dual P1 | **coordinate-frame-policy**, **compute-partial-first-class** |
| 2026-08-11 compute form | **compute-form-design-acceptance** — closed 5/5 (reopened after a false fossil-close; 11 new page tests guard empties/copy/cancel/rail floor) |
| 2026-08-11 fossils | app-abstraction-sink, structure-id-boundary |
| 2026-08-10 compute worker | optimize-worker-ship, workload-analysis-jobs |
| 2026-08-10 P2 pack | vsc-sketch-quick-view, multi-datasource-compose, ui-data-inspector-touch, ui-empty-states, ui-resize-coalesce |

## Older shipped batches

### 2026-07-31 — close backlog + product polish

- scene-modifier-iron-law, stage-commit-scene, package-split-core-stage, shared-element-picker-01..04

### 2026-07-30 — OVITO parity

- ovito-parity-01..07, ovito-modifier-align

### 2026-07-29 — molvis-sketch chain

- molvis-sketch-01..04

### 2026-07-24

- select-modifier-expression, trajectory-play-prefetch, core-app-scene-facade
- camera keyframe, RPC schema, artist representation split, VSCode outline
