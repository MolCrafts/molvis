---
title: 分析层前置接缝：id 常量 · 同名异形 · analysis barrel
status: done
created: 2026-08-14
---

# 分析层前置接缝：id 常量 · 同名异形 · analysis barrel

## Summary

在把 compute worker 改成 catalog 驱动之前，先把 `stage/src/analysis` 的三处结构性障碍清干净：`AnalysisRunOptions` 在 `dispatch.ts:53` 与 `trajectory_runner.ts:67` 同名异形（共享模块签名统一后必然撞车）、molrs compute catalog 的分析 id 以裸字符串散落在 dispatch / job_runner / cluster_pipeline 三个文件、以及 `stage/src/analysis` 缺少 `optimize/` 已有的 Wire/Main/Kernel 层次栅栏。本环不改任何运行时行为：分析结果、面板表现、worker 能跑的分析集合都与改动前逐字节一致；交付物是后续四环共享模块签名时可以直接依赖的命名与层次接缝。

## Design

**触碰的实体**

- `stage/src/analysis/dispatch.ts` —— 主线程编排入口。其内部 `AnalysisRunOptions`（:53）只在本文件四处使用（:366/:404/:446/:512），且**未**出现在 `stage/src/index.ts` 的 dispatch 导出块（index.ts:75-80 只导出 `AnalysisParamValues` / `AnalysisRunResult` / `AnalysisUnsupportedError` / `runAnalysis`），因此重命名为 `AnalysisDispatchOptions` 不触碰公共面。公共面的 `AnalysisRunOptions` 仍来自 `trajectory_runner.ts`（index.ts:159）。
- `stage/src/analysis/analysis_ids.ts`（新）—— Wire 层，**零 import**：只有 molrs compute catalog（0.13.1）的 id 字符串常量。零 import 是这个模块能同时被 worker kernel、主线程编排、pipeline modifier 和 page 面板引用而不制造耦合的全部理由。命名沿用树内既有拼法 `*_ANALYSIS_ID`（`cluster_pipeline.ts:103` 的 Closest pattern），不发明命名空间对象。
- `stage/src/analysis/index.ts`（新）—— 层次 barrel，形式逐条照抄 `stage/src/optimize/index.ts:1-13` 的 Wire/Main/Kernel 表：只再导出 Wire（`worker_protocol`）与 Main（`worker_client` / `dispatch` / `registry` / `requirements` / `rdf_params` / `trajectory_runner` / `cluster*` / `rings` / `topology_analysis` / `exploration` / `panel_inputs` / `utils`）；kernel（`job_runner` / `rdf` / `msd` / `trajectory_analyses`，以及后续环加入的 `shape_dispatch` / `result_marshal`）**只允许按路径 import**，barrel 不得再导出。worker 入口若 import 到 barrel，就会把 Babylon 侧依赖拖进 worker chunk —— 这条是本模块的唯一失效模式，因此写进模块头注释并由验收项守住。
- `stage/src/pipeline/cluster_pipeline.ts` —— `COM_ANALYSIS_ID` / `RG_ANALYSIS_ID`（:103,:105）声明迁入 `analysis_ids.ts`，本文件 `import` 后**原名再导出**，使 `stage/src/index.ts:508-522` 的导出块逐字不变；`isComAnalysisId` / `isRgAnalysisId` 谓词原样保留（pipeline 关注点，见 Reuse decision）。
- `stage/src/index.ts` —— 分析相关的十余个 `from "./analysis/*"` 导出块改道 `from "./analysis"`，与 index.ts:468 的 `from "./optimize"` 取齐；同时新增 `analysis_ids.ts` 的常量导出（page 侧第 06 环要用）。导出的**符号集合**不增不减（除新增常量），排序由 biome 决定。

**生命周期 / 所有权**：本环不新建任何持有 molrs 句柄的对象，不改变任何 `free()` 时机。`analysis_ids.ts` 是不可变模块级字面量；barrel 是纯再导出，无 import-time side effect（不得进 `stage/package.json` 的 `sideEffects` 允许名单）。

**形态自检**：两个新模块各自单一职责（一个是名字表，一个是层次栅栏），无工厂函数、无 context 包、无门面；`analysis_ids.ts` 的单测只需 import 它自己（零 import 使 fake 都不需要）；barrel 无独立单测面（它没有行为），由验收项与 typecheck 守。

### Reuse decision

- `cluster_pipeline.COM_ANALYSIS_ID` / `RG_ANALYSIS_ID`（cluster_pipeline.ts:103,105）→ **generalize** —— 声明提升到 `analysis_ids.ts` 服务 dispatch / job_runner / page 三方调用者，`cluster_pipeline` 改为 import + 再导出，公共 API 名称与路径不变。
- `cluster_pipeline.isComAnalysisId` / `isRgAnalysisId`（:107,:111）→ **reuse**（保留原位）—— 这是 pipeline 层"这个 id 要不要装 modifier"的谓词，不是 result marshalling；跨链锁定为保留。
- `stage/src/optimize/index.ts:1-13`（层次 barrel 样板）→ **pattern** —— 新 barrel 的注释表头与"kernel 按路径 import"规则逐条照抄。
- `stage/src/io/formats.ts:70` `FILE_FORMAT_REGISTRY`（readonly 模块级字面量表样板）→ **pattern**，在第 02 环 `result_marshal.ts` 使用；本环不引入表。
- `stage/src/commands/registry.ts:19`（mutable Map + register 模式）→ **new — 显式不采用**：宿主可扩展面的模式，marshalling / id 集是闭集，register-at-import 还会牵出 `sideEffects` 允许名单问题。
- `dispatch.AnalysisUnsupportedError`（dispatch.ts:43）→ **reuse**（本环不触碰，第 02/04 环复用，不造新错误类）。
- `trajectory_runner.runTrajectoryFrames`（:353）、`job_runner.SnapshotTrajectory`（:56）、`AnalysisWireParams.selection()`（:246）、`dispatch.coerce/ctorArgs/instantiate`（:114,150,187）、`trajectory_analyses.averageRdfResults`（:97）、`msd.MsdAnalyzer`（:37）、`worker_protocol.snapshotFrameForAnalysis`（:250）、`worker_client.runAnalysisOnWorker`、`analysis/panel_inputs.ts`、`analysis/requirements.ts` → **deferred，逐个已在链条中指名**：03 环 generalize `runTrajectoryFrames` 与 `averageRdfResults`（reducer 表项）、04 环 reuse `SnapshotTrajectory` / `coerce`·`ctorArgs`·`instantiate` / `AnalysisWireParams.selection()` 并 generalize `MsdAnalyzer` 为唯一 MSD 驱动、05 环 generalize `snapshotFrameForAnalysis` 为范围版、06 环 reuse `runAnalysisOnWorker`；`panel_inputs.ts` 与 `requirements.ts` 全链 reuse 原样不改。本环不触碰其中任何一个，也不重新实现任何一个。

## Files to create or modify

- `stage/src/analysis/analysis_ids.ts` (new)
- `stage/src/analysis/index.ts` (new)
- `stage/src/analysis/dispatch.ts`
- `stage/src/analysis/job_runner.ts`
- `stage/src/pipeline/cluster_pipeline.ts`
- `stage/src/index.ts`
- `stage/tests/analysis/analysis_ids.test.ts` (new)
- `regressions/worker-catalog-dispatch-01-seams.ts` (new)

## Tasks

- [x] Write failing unit tests for AnalysisIds (stage/tests/analysis/analysis_ids.test.ts → TestAnalysisIds)
- [x] Implement the catalog id constants in stage/src/analysis/analysis_ids.ts (new, zero imports)
- [x] Rename the dispatch-internal AnalysisRunOptions to AnalysisDispatchOptions in stage/src/analysis/dispatch.ts
- [x] Replace catalog id literals with the shared constants in stage/src/analysis/dispatch.ts, stage/src/analysis/job_runner.ts and stage/src/pipeline/cluster_pipeline.ts, keeping COM_ANALYSIS_ID / RG_ANALYSIS_ID re-exported from cluster_pipeline
- [x] Add the analysis layer barrel stage/src/analysis/index.ts with the Wire/Main/Kernel table
- [x] Reroute the analysis export blocks in stage/src/index.ts through ./analysis and export the id constants
- [x] Add docstrings per jsdoc-tiered to analysis_ids.ts (source: molrs 0.13.1 compute catalog) and index.ts (layer + thread rules)
- [x] Verify no kernel module (job_runner, rdf, msd, trajectory_analyses) imports the new barrel
- [x] Add regression example regressions/worker-catalog-dispatch-01-seams.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite
- [x] Hygiene: /mol:simplify ran clean (0 apply; pre-existing runAnalysis length debt lands on chain 03)

## Testing strategy

单测只在 `stage/tests/` 下，路径镜像源码，类型镜像类型；单个 unit 的绿灯 = `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/analysis_ids.test.ts`（不跑全量套件）。测试环境是 `@rstest/browser` headless chromium（`stage/rstest.config.ts`）+ `tests/setup_wasm.ts`，**没有 fs**，因此"kernel 不 import barrel"只能作为 code 类验收项由 `/mol:impl` grep 核，不写成单测。

- `stage/tests/analysis/analysis_ids.test.ts` → `TestAnalysisIds`
  - happy path：每个常量等于其**硬编码**字符串字面量（`RDF_ANALYSIS_ID === "rdf.radial_distribution"`、`MSD_ANALYSIS_ID === "msd.mean_squared_displacement"`、`CLUSTER_ANALYSIS_ID === "cluster.connected_components"`、`COM_ANALYSIS_ID === "shape.center_of_mass"`、`RG_ANALYSIS_ID === "shape.cluster_properties"`、`POWER_SPECTRUM_ANALYSIS_ID === "spectroscopy.power_spectrum"`、三个 `voronoi.*`）。
  - edge case：测试内自行组数组断言九个常量互不相同（一次复制粘贴错误就会咬）。
  - 契约用例：对每个常量 `getAnalysisDefinition(id)` 有定义 —— 这是把"常量集合"钉死在 molrs 0.13.1 catalog 上的那道闸。**该用例失败意味着 dispatch 里存在死分支**（catalog 已无此 id），按 no-silent-debt 走 `/mol:debug` 或在本环修掉，禁止弱化断言或删常量了事。
- 已有 `stage/tests/analysis/job_runner.test.ts:17-18` 自带 `RDF_ID` / `MSD_ID` 局部常量：测试文件保持自持（测试不 import 被测系统的常量来自证），本环不改动该文件。
- 回归样例：`regressions/worker-catalog-dispatch-01-seams.ts` —— 只走公共 API（`../stage/dist/index.js`），断言三个 id 常量等于**内嵌字面量**（来源注释：molrs compute catalog 0.13.1，`@molcrafts/molrs@^0.13.1`，2026-08-14），断言 `runAnalysis` / `expandFrameRange` / `snapshotFrameForAnalysis` 仍在公共面上，并断言公共 barrel **不**暴露 kernel 符号（`runAnalysisJob` 不在命名空间导入里）。不加载 WASM、不调 molrs 运行时，样式对齐 `regressions/theme-tab10-ovito-02-wire.ts`。

## Out of scope

- marshalling 表（`result_marshal.ts`）、shape 分发（`shape_dispatch.ts`）、runner 放宽与 accumulate runner、worker 的 catalog 分发 —— 分别属于本链 02 / 03 / 04 环。
- page 侧任何改动，含 `RdfPanel.tsx:56` / `MsdPanel.tsx:39` / `LeftSidebar.tsx:66-81` 的字面量收敛与 `GenericAnalysisPanel` 上 worker —— 属于 06 环。
- `useAnalysisCatalog.ts:48-69` 与 `molpy-docs.ts:34-58` 的 record key：全链**保留字面量**（展示/文档查表，非分发身份）。
- `panel_inputs.ts` 改名、`exploration.ts` 的 `runExploration`、`requirements.ts` 的可用性探测策略 —— 全链不动。
- 主线程 `runAnalysis` 入口的路由策略（是否强制全部上 worker）—— 全链不动。
- molrs 侧统一 result payload / Rust RDF accumulator —— molrs 仓库、下个发版。
