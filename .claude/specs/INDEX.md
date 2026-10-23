# Specs Index

Active runtime specs. `/mol:spec` adds an entry here; `/mol:impl` ticks the
spec's tasks off and prunes the entry (and file) on completion.

## Open

- [traj-ingest-03-hud](traj-ingest-03-hud.md) — page HUD 仍要求 `ViewerStatusOverlay` 与 Timeline 单测；扫描提示已改走 `status-message`，时间轴单测不存在 [in-progress]
- [traj-ingest-05-remote](traj-ingest-05-remote.md) — Remote 帧表：`remote.md` 未写三级放置与 sidecar 命中跳过 SSH 全扫；EH indexer 仍 import stage `io/formats`；对应单测被 `tsconfig.test.json` exclude [approved]
- [one-viewer-surface-04-surface-roundtrip](one-viewer-surface-04-surface-roundtrip.md) — 宿主 `setSurface` 已在；webview→host 的 `surfaceChanged` 不存在 [approved]
- [one-viewer-surface-05-editors-and-truth](one-viewer-surface-05-editors-and-truth.md) — 两个自定义编辑器已用 page HTML，但 `molvis.openInPage` 仍关闭编辑器再开 Page [approved]
- [page-host-init-single-path](page-host-init-single-path.md) — `MolvisWrapper` 仍注册 `handleHostMessage`；门禁测试文件不存在 [approved]
- [worker-arch-unify-04-bootstrap](worker-arch-unify-04-bootstrap.md) — webview blob bootstrap 实机验证（陷阱 2 疑点）并收敛为单一路径 [approved]

Chain `traj-ingest`: 00、01、02、04、06 已关（实现在树上，`regressions/` 车道已于 2026-09-20 废除，由对应单测代替）。仍开：03、05。`.molidx` = 帧偏移缓存，不是 sidecar 格式体系。

Chain `worker-arch-unify`: 01 → 02 → 03 → 04（严格串行；03 为 stage+vsc-ext 最小原子 seam，04 依赖 alias 已就位）。01-channel、02-runtime、03-spawn 已 done（2026-08-20 shipped：信道扩展 + TrajectoryRuntime/worker 重建 + `./worker-spawner` seam；declared breaking：`./trajectory-protocol` 死 wire 类型、`spawnTrajectoryWorker`/`spawnComputeWorker` 迁出原出口；`worker-rewrites` 正则已退役为一行 alias）。02 路由债：DCD `.molidx` hit 路径不喂 decoder context（既有行为，`/mol:debug` 候选）；OPFS source `filename` 类型逃逸（pm 候选）。与 `traj-ingest` 的交点：`TrajectorySource.readRange` seam 形状冻结（04-range/05-remote 依赖）。

## Shipped (recent)

| Batch | Specs |
|-------|--------|
| 2026-10-02 close landed | **traj-ingest-00, 01, 02, 04, 06** and **one-viewer-surface-01..03** — code already in tree; named unit tests green; `regressions/` lane not revived |
| 2026-08-16 viewer pack shape | **viewer-pack-shape-01-names**, **viewer-pack-shape-02-gltf** — CDN entry `main.js` + named chunks; glTF export moved to `./export-gltf` lazy host subpath (−303 kB async chunks) |
| 2026-08-15 optimize staging | **optimize-staging-01..05** — edit-pool position writer extraction, commit column preservation (+F32 debt fix), staged optimize results (undoable command, Ctrl+S lands), live relax paint (coords beats), panel copy inversion. En route: writeback hotfix 4b1a32e, bondType payload bug fix, commit-drops-columns bug fix |
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
