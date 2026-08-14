---
title: 分析结果 marshalling 表：per-id 收编 + 默认穿透
status: done
created: 2026-08-14
---

# 分析结果 marshalling 表：per-id 收编 + 默认穿透

## Summary

`dispatch.ts` 里按分析 id 散落着四处「把 molrs 拥有型结果类拷成 plain data 并 free 句柄」的特判：`normalizeResult` 的 rdf / cluster 两支（:333-359）、`runSingleFrame` frameClusters 出口的 `shape.center_of_mass` 三元分支（:294）与其 `centersOfMassPayload`（:317）、以及 `runAccumulate` 的 msd 结果分支（:384-392）。它们的共同点是「molrs 0.13.1 的 compute catalog 没有描述 result 的序列化形状」，共同点之外没有任何东西把它们和主线程编排绑在一起 —— 所以本环把这四处收编进一个 kernel 层的 readonly per-id 表 `result_marshal.ts`，未列出的 id 走 `return raw` 默认穿透，`dispatch.ts` 从此不再按 id 判断结果形状。表模块头部把自己声明为**临时 seam**：molrs 统一 result 表面后此表收缩为空、模块随之删除。本环不改任何 payload 形状、不改任何 free 时机、不改公共 API 符号集合。

## Design

**新模块 `stage/src/analysis/result_marshal.ts`（Kernel 层，不进任何 barrel）**

- 形态照抄 `stage/src/io/formats.ts:70` 的 `FILE_FORMAT_REGISTRY`：模块级 `readonly` 字面量表 + 一个查表函数。**不采用** `stage/src/commands/registry.ts:19` 的 mutable `Map` + `register()` 模式 —— 那是宿主可扩展面的形态，marshalling 集是闭集，register-at-import 还会把本模块拖进 `stage/package.json` 的 `sideEffects` 允许名单。
- 表键是 catalog id 常量，从 01 环的 `./analysis_ids` import（本模块不写裸字符串）；表值是 `(raw: unknown) => unknown`：拷列、free 句柄、返回 plain data。四个条目：`RDF_ANALYSIS_ID`（`binCenters/binEdges/rdf/pairCounts/numPoints/rMin/volume`）、`CLUSTER_ANALYSIS_ID`（`clusterSizes/clusterIdx/numClusters`）、`COM_ANALYSIS_ID`（`centersOfMass/clusterMasses/numClusters`）、`MSD_ANALYSIS_ID`（`MSDResult[]` → `Array<{mean, perParticle}>`，逐个 `free()`）。字段名、字段顺序、`free()` 位置与今天的四处特判逐字段一致 —— 本环是搬运，不是重写。
- 导出面只有两个符号：`ANALYSIS_RESULT_MARSHALLERS`（readonly 表，供单测逐条驱动）与 `marshalAnalysisResult(analysisId, raw)`。后者 `?? (value) => value` 默认穿透，因此新增一个 catalog 分析**不需要**改本模块 —— 这正是 `dispatch.ts:358` 现状已经正确的默认，只是被搬到了唯一的地方。
- 结果句柄不成形（binding 的 `compute?.()` 返回 `undefined`，或不是对象）时抛 `AnalysisUnsupportedError(analysisId, …)`，不造新错误类。今天这种情况会以 `Cannot read properties of undefined` 形式炸在无关的调用栈上。

**`AnalysisUnsupportedError` 的归属（前置动作）**

`AnalysisUnsupportedError` 现声明在 `dispatch.ts:43`，而 `dispatch.ts` 是 Main 层（它 import `../system/trajectory`）。Kernel 的 `result_marshal.ts` 不得 import Main。因此声明**迁到 `trajectory_runner.ts`**，紧邻它的同族 `AnalysisAbortError`（:148）：该模块的运行时 import 只有 `utils/dtype` + `utils/yield_ui`，是 worker 侧已经在用的共享层（`job_runner.ts:23-28` 已 import 它），`compute/index.ts:17-19` 描述的正是这类"pipeline 与 kernel 共用的小模块"。`dispatch.ts` 改为 import 后**原名再导出**，`stage/src/index.ts:75-80` 的 dispatch 导出块逐字不变，公共 API 零变化。

**`dispatch.ts` 的收敛点**

- `runSingleFrame` 的每个 per-frame 出口（`frame` / `frameNeighbors` / `frameClusters`）以及 `runFrameRadii` / `runFrameGroups` 的出口，统一写成 `return marshalAnalysisResult(definition.id, instance.compute?.(…))`。**调用必须留在各自的 `try` 内、`finally` 的 `free()` 之前** —— 与今天 `normalizeResult` 在 :272 的位置一致。绝不把 marshalling 挪到 `finally` 之后去读一个其产出 binding 已被 free 的结果对象（molrs 句柄追踪不变量：不假设结果对象与产出它的 binding 生命周期无关）。
- `frameClusters` 分支的 `definition.id === COM_ANALYSIS_ID ? … : raw` 三元整体消失（表接管）。`cluster_pipeline.ts:107` 的 `isComAnalysisId` 谓词**保留原位**：那是 pipeline 层"要不要装 modifier"的判断，与 result marshalling 无关（跨链锁定决策）。
- `runAccumulate` 的 msd 分支替换为 `marshalAnalysisResult(definition.id, instance.results?.() ?? instance.compute?.())`；注意 msd 走 `results()`、其余走 `compute()`，这一处**驱动方式**的 id 差异本环不处理，属 03 环（`MsdAnalyzer` 成为唯一 MSD 驱动）。
- `normalizeResult` 与 `centersOfMassPayload` 两个私有函数删除。

**内聚 / 可测性**：`result_marshal.ts` 的唯一职责是"结果形状"，依赖只有 `./analysis_ids`（零 import）与 `./trajectory_runner` 的错误类；它的单测只需喂手写假句柄（带 `free()` 的普通对象），不需要 WASM、不需要 Frame、不需要全量套件 —— 这就是它必须独立成模块的判据。

### Reuse decision

- `dispatch.normalizeResult`（:333）/ `centersOfMassPayload`（:317）/ `runAccumulate` msd 分支（:384）→ **generalize**：三段实现原样提升为表条目，服务 dispatch 与（04 环起）worker 两个调用者，随后从 dispatch 删除。
- `dispatch.AnalysisUnsupportedError`（:43）→ **generalize**：声明迁至 `trajectory_runner.ts` 与 `AnalysisAbortError` 同处，dispatch 再导出保公共路径；**不造新错误类**。
- `stage/src/io/formats.ts:70` `FILE_FORMAT_REGISTRY` → **pattern**：readonly 模块级字面量表 + 查表函数的形状、命名与注释密度照此。
- `stage/src/commands/registry.ts:19`（mutable Map + register）→ **new — 显式不采用**，理由见 Design（闭集 + sideEffects 允许名单）。
- `analysis_ids.ts`（01 环）→ **reuse**：表键与 dispatch 的所有 id 引用都来自它，本模块不出现裸 id 字符串。
- `cluster_pipeline.isComAnalysisId` / `isRgAnalysisId`（:107,:111）→ **reuse**（保留原位，pipeline 关注点）。
- `stage/src/analysis/cluster_properties.ts:50,77`（已有的 `WasmClusterResult` / `WasmCenterOfMassResult` 拷列路径）→ **new — 不收编**：那是 pipeline 从**掩膜**算簇性质的独立路径（自建 Cluster、自负句柄），与 catalog binding 的结果序列化不是同一件事；把两者塞进一张表会让表同时承担两种所有权模型。
- `trajectory_runner.runTrajectoryFrames` / `job_runner.SnapshotTrajectory` / `dispatch.coerce`·`ctorArgs`·`instantiate` / `msd.MsdAnalyzer` / `trajectory_analyses.averageRdfResults` / `worker_protocol.snapshotFrameForAnalysis` / `worker_client.runAnalysisOnWorker` / `panel_inputs.ts` / `requirements.ts` → **deferred**，分别在 03 / 04 / 05 / 06 环处置（见链条锁定决策）；本环一个都不触碰，也不重新实现。

## Files to create or modify

- `stage/src/analysis/result_marshal.ts` (new)
- `stage/src/analysis/dispatch.ts`
- `stage/src/analysis/trajectory_runner.ts`
- `stage/tests/analysis/result_marshal.test.ts` (new)
- `regressions/worker-catalog-dispatch-02-marshal.ts` (new)

## Tasks

- [x] Write failing unit tests for ResultMarshal (stage/tests/analysis/result_marshal.test.ts → TestResultMarshal)
- [x] Move AnalysisUnsupportedError into stage/src/analysis/trajectory_runner.ts next to AnalysisAbortError and re-export it from stage/src/analysis/dispatch.ts
- [x] Implement ANALYSIS_RESULT_MARSHALLERS and marshalAnalysisResult in stage/src/analysis/result_marshal.ts (new) with the temporary-seam contract docstring per jsdoc-tiered
- [x] Replace normalizeResult and centersOfMassPayload with marshalAnalysisResult at every per-frame shape exit in stage/src/analysis/dispatch.ts, keeping the call inside each try before its free()
- [x] Replace the msd results branch of runAccumulate with marshalAnalysisResult in stage/src/analysis/dispatch.ts
- [x] Verify result_marshal.ts is exported by neither stage/src/analysis/index.ts nor stage/src/index.ts
- [x] Add regression example regressions/worker-catalog-dispatch-02-marshal.ts (fake result handles; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

单测只在 `stage/tests/` 下，路径镜像源码；单 unit 绿灯 = `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/result_marshal.test.ts`（不跑全量）。环境是 `@rstest/browser` headless chromium + `tests/setup_wasm.ts`，**没有 fs** —— 所以"表不进 barrel"只能是 code 类验收项（grep），不写成单测。

- `stage/tests/analysis/result_marshal.test.ts` → `TestResultMarshal`（本模块的假句柄全部手写，**不引入 molrs**，因此该文件是 analysis 目录下唯一不需要 WASM 的测试）
  - happy path，逐条目一个用例：喂一个实现了对应 getter 的假句柄，断言产出对象的**每个字段**等于硬编码期望值（如 rdf 条目：`binCenters` `[0.5, 1.5]`、`numPoints` 2、`rMin` 0、`volume` 8000），并断言假句柄的 `free()` 恰好被调用一次（拷列后立即释放是本表的契约）。
  - msd 条目：喂两个假 `MSDResult`，断言产出 `[{mean, perParticle}, …]` 顺序保持、两个句柄都被 free。
  - 默认穿透：`marshalAnalysisResult("voronoi.radical_voronoi", sentinel)` 返回**同一个引用**（`toBe`），且不调用任何方法 —— 这是"新增 catalog 分析不必改本模块"的可执行证据。
  - 边界：`raw` 为 `undefined` / 非对象时抛 `AnalysisUnsupportedError`，且 `error.analysisId` 等于传入 id、`name` 为 `"AnalysisUnsupportedError"`（证明复用而非新错误类）。
- 已有 `stage/tests/analysis/job_runner.test.ts` 与 `rdf.test.ts` 不改动：本环 payload 形状零变化，它们是"没有回归"的现成证人；任何一处变红都说明搬运不等价，按 no-silent-debt 停下来查，不得改测试迁就实现。
- 回归样例 `regressions/worker-catalog-dispatch-02-marshal.ts`：import `../stage/dist/analysis/result_marshal.js`（本模块按不变量**故意不在公共 barrel** 上，因此按构建产物深路径钉住 —— 与 `regressions/theme-tab10-ovito-01/02` 已有的深路径 dist import 同惯例），用假句柄驱动 rdf 条目与一个未列出 id，断言硬编码字段值、`free()` 调用次数与穿透的引用相等。全程纯 JS 对象：不加载 WASM、不调 molrs、不跑第三方软件。

## Out of scope

- worker 侧 `computeByAnalysisId` 改 catalog 形状分发、`shape_dispatch.ts` —— 04 环。
- `runTrajectoryFrames` 放宽、`runTrajectoryAccumulate`、三处循环收敛、`MsdAnalyzer` 成为唯一 MSD 驱动 —— 03 环；因此本环保留 dispatch 中「msd 走 `results()`、其余走 `compute()`」这处驱动差异，**不**顺手改（改它需要 03 的 runner 才有落点）。
- `cluster_pipeline.ts:107` 谓词、`GenericAnalysisPanel.tsx:128-176` 面板短路 —— 跨链锁定为保留（理由见 01 环链条决策）。
- `cluster_properties.ts` 的掩膜路径、`exploration.ts`、`requirements.ts` —— 全链不动。
- molrs 侧统一 result payload（本表收缩为空的那一天）—— molrs 仓库，下个发版。
