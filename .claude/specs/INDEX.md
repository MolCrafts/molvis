# Specs Index

Active runtime specs. `/mol:spec` adds an entry here; `/mol:impl` ticks the
spec's tasks off and prunes the entry (and file) on completion.

## Open

- [traj-ingest-00-molrs](traj-ingest-00-molrs.md) — MolRS 是唯一轨迹 streaming 基建；DCD/XTC/TRR 同面；host 不得自写 indexer [approved]
- [traj-ingest-01-index](traj-ingest-01-index.md) — stage first-frame-first + Trajectory 三分量 + host-range source 缝 [approved]
- [traj-ingest-02-sidecar](traj-ingest-02-sidecar.md) — `.molidx` 帧索引表 v2（MolRS 产出的 offset 缓存，不是新格式） [approved]
- [traj-ingest-03-hud](traj-ingest-03-hud.md) — page HUD / 时间轴 / 分析范围消费三分量 [approved]
- [traj-ingest-04-range](traj-ingest-04-range.md) — vsc-ext `openUri` / `readRange`，轨迹不再整文件拷贝 [approved]
- [traj-ingest-05-remote](traj-ingest-05-remote.md) — Remote：EH 调 **同一份 MolRS** 建表 + 三级 `.molidx` 放置 [approved]
- [traj-ingest-06-source](traj-ingest-06-source.md) — DataSource 删除 kind；子类做来源→内部对象；ssh/http 不是 DS、不进 MolRS [approved]
- [worker-arch-unify-04-bootstrap](worker-arch-unify-04-bootstrap.md) — webview blob bootstrap 实机验证（陷阱 2 疑点）并收敛为单一路径 [approved]

Chain `traj-ingest`: **00（molrs 面）** → 01 → 02；03 可与 02 并行；04 依赖 01 `kind: "host"`；05 依赖 00+02+04；06 可与 01 后并行。Phase 0 已在树里。`.molidx` = 帧偏移缓存，不是 sidecar 格式体系。

Chain `worker-arch-unify`: 01 → 02 → 03 → 04（严格串行；03 为 stage+vsc-ext 最小原子 seam，04 依赖 alias 已就位）。01-channel、02-runtime、03-spawn 已 done（2026-08-20 shipped：信道扩展 + TrajectoryRuntime/worker 重建 + `./worker-spawner` seam；declared breaking：`./trajectory-protocol` 死 wire 类型、`spawnTrajectoryWorker`/`spawnComputeWorker` 迁出原出口；`worker-rewrites` 正则已退役为一行 alias）。02 路由债：DCD `.molidx` hit 路径不喂 decoder context（既有行为，`/mol:debug` 候选）；OPFS source `filename` 类型逃逸（pm 候选）。与 `traj-ingest` 的交点：`TrajectorySource.readRange` seam 形状冻结（04-range/05-remote 依赖）。

## Shipped (recent)

| Batch | Specs |
|-------|--------|
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
- [one-viewer-surface-01-chrome-state](one-viewer-surface-01-chrome-state.md) — page: collapse the canvasOnly early return into one render tree so a surface flip never tears down Babylon, and make MountOpts live state (MountOptsStore + MountedApp.setOpts). [approved]
- [one-viewer-surface-02-surface-message](one-viewer-surface-02-surface-message.md) — vsc-ext: carry the surface on `init` via a non-claiming `onMessageSeen` observer on attachStageHost, consumed by a new attachPageHost. [approved]
- [one-viewer-surface-03-quicklook-surface](one-viewer-surface-03-quicklook-surface.md) — vsc-ext: Quick look serves the page bundle chrome-off, with boot-time surface injection, the capability registry moved, the outline reverse route fixed and drop parity kept. [approved]
- [one-viewer-surface-04-surface-roundtrip](one-viewer-surface-04-surface-roundtrip.md) — vsc-ext: the host owns the surface; promoting is a setSurface message, the tab retitles, and a replayed init keeps the promoted state. [approved]
- [one-viewer-surface-05-editors-and-truth](one-viewer-surface-05-editors-and-truth.md) — vsc-ext + docs: migrate the two custom editors, redefine molvis.defaultViewer as chrome off/on, and correct every "promoting reloads" claim. [approved]
- [page-host-init-single-path](page-host-init-single-path.md) — page: delete MolvisWrapper's duplicate window init/applySettings handler so attachStageHost is the single path (no host outside vsc-ext ever sends those messages). [approved]
