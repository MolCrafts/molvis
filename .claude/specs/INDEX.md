# Specs Index

Active runtime specs. `/mol:spec` adds an entry here; `/mol:impl` ticks the
spec's tasks off and prunes the entry (and file) on completion.

## Open

- [worker-catalog-dispatch-01-seams](worker-catalog-dispatch-01-seams.md) — 分析层前置接缝：id 常量模块 + dispatch 内部同名异形改名 + analysis 层次 barrel（链 1/6） [approved]
- [worker-catalog-dispatch-02-marshal](worker-catalog-dispatch-02-marshal.md) — result_marshal.ts per-id 表收编四处结果特判，默认穿透，临时 seam 契约（链 2/6） [approved]
- [worker-catalog-dispatch-03-runner](worker-catalog-dispatch-03-runner.md) — runTrajectoryFrames 放宽帧源 + runTrajectoryAccumulate；三处手写循环收敛，修 missingTrackedAtoms/accumulate 选择缺陷（链 3/6） [approved]
- [worker-catalog-dispatch-04-dispatch](worker-catalog-dispatch-04-dispatch.md) — shape_dispatch.ts 抽出线程无关形状分发；worker 两 ID 枚举退场，snapshotCoversAnalysis 准入谓词（链 4/6） [approved]
- [worker-catalog-dispatch-05-snapshots](worker-catalog-dispatch-05-snapshots.md) — snapshotFramesForAnalysis 范围版快照打包，收敛两面板重复循环的落点（链 5/6） [approved]
- [worker-catalog-dispatch-06-panels](worker-catalog-dispatch-06-panels.md) — GenericAnalysisPanel 按 planAnalysisRun 三路由上 worker；快照循环与分发身份字面量收敛（链 6/6） [approved]

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
