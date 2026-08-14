---
title: worker catalog 形状分发：shape_dispatch 抽出 + 两 ID 枚举退场
status: approved
created: 2026-08-14
---

# worker catalog 形状分发：shape_dispatch 抽出 + 两 ID 枚举退场

## Summary

compute worker 至今只认两个写死的分析 id（`job_runner.ts:42-43`），其余 catalog 分析一律答 "not available on the worker"（:309）—— 不是因为算不了，而是因为 worker 侧没有主线程那套按 `inputKind` 的形状分发。本环把 `dispatch.ts` 里与线程无关的那半边（`runSingleFrame` 及其参数强制/构造助手、03 环加入的 `CatalogAccumulator`、`PER_FRAME_KINDS`）整体迁进新的 Kernel 模块 `shape_dispatch.ts`，两条线程共用同一套形状分发；worker 的 `computeByAnalysisId` 改为「rdf / msd 走轨迹条目层，其余按 catalog 形状分发」，definition 由 worker 自己 `getAnalysisDefinition(id)` 解析，wire 上仍然只传 id（`worker_protocol.ts` 的 job 形状不变）。同时把一条一直隐含、从未写下来的约束变成显式谓词：分析作业快照只携带坐标 / 元素 / id / 盒子，因此需要速度列、键块或上游结果的 catalog 分析在 worker 上根本不可运行 —— 与其让它在 kernel 深处炸出一句无关的错误，不如让调用方在提交前就能问"这个分析能不能上 worker"。

## Design

**新模块 `stage/src/analysis/shape_dispatch.ts`（Kernel 层，不进任何 barrel）**

- 从 `dispatch.ts` 迁入、函数体基本原样：`wasmClass`、`numbers`、`coerce`（:114）、`ctorArgs`（:150）、`callValue` / `callNumber`（:159,169）、`instantiate`（:187）、`runFrameRadii`、`runFrameGroups`、`runSingleFrame`（:250）、`PER_FRAME_KINDS`（:496），以及 03 环落在 dispatch 的 `CatalogAccumulator`。判据是线程无关性：这些代码的依赖集是 molrs + `../algo/neighbor_list` + `./panel_inputs` + `./registry` + `./result_marshal` + `./frame_subset`，**没有一个**是 Babylon / pipeline modifier / DOM —— 迁移不是为了复用而复用，是这半边本来就不属于主线程编排。
- `AnalysisParamValues`（`dispatch.ts:40`，公共 API，`stage/src/index.ts:76`）声明随 `coerce` 迁入本模块，`dispatch.ts` 原名再导出，公共导出路径逐字不变（与 01–02 环处理 `COM_ANALYSIS_ID` / `AnalysisUnsupportedError` 同一手法）。
- `dispatch.ts` 迁出后只剩主线程编排：帧循环（03 环已改调 `runTrajectoryFrames`）、`runSeries` / `stackVectorColumns`、`AnalysisRunResult` 信封、公共 `runAnalysis`。它继续 import kernel（Main → Kernel 允许），反向永远禁止。
- `panel_inputs.ts` 原样复用、不拆不改名（它只依赖 molrs + dtype，已 worker-safe）。

**wire 面新增两个符号（`worker_protocol.ts`，Wire 层，进公共 barrel）**

- `AnalysisShapeResult`：形状分发在 worker 上的结果信封 —— `{ frameIndices, perFrame, failures, value }`。`failures` 是 `{ frameIndex, message }[]` 而**不是** `AnalysisFrameFailure`：`Error` 跨 `postMessage` 会掉原型（自定义子类变成普通 Error），把它塞进 wire 是给自己埋坑；面板只需要条数与消息。`AnalysisRunResult`（Main 层，含 `trackedSelection` 与真 `Error`）保持不变，两者不是同一个类型，也不互相替代。
- `snapshotCoversAnalysis(definition): boolean`：一个分析能否被 `AnalysisFrameSnapshot` 表达。判据两条 —— `inputKind` 属于逐帧或 accumulate 形状（`series` 的速度矩阵、`frameGroupSets` 的多组编辑器都不在快照的表达范围内），且 `requires` 的每一项都在 `SNAPSHOT_SATISFIED_REQUIREMENTS` 里。该集合今天**只含 `voidMask`**（它来自 job 的 selection 参数而非帧列），并在注释里逐条写明其余项为何不满足：`velocity` / `charge` / `dipole` / `orientation` 是快照不携带的原子列（`snapshotFrameForAnalysis` 只拷 x/y/z/element/id + cell）、`atomPairs` / `atomTriples` / `atomQuads` / `atomGroups` 需要快照没有的 bonds 块、`labels` 需要任意标签列、其余是上游结果。谓词放在 `worker_protocol.ts` 是因为它回答的正是"快照携带了什么"，与 `snapshotFrameForAnalysis` 是同一个知识点的两面；放到别处就会出现第二份"快照有哪些列"的真相。
- worker 侧把同一个谓词用作准入闸：不通过就抛 `AnalysisUnsupportedError`（复用，02 环已迁到 `trajectory_runner.ts`）并点名是哪一条 requirement 挡住的。面板（06 环）用同一个谓词决定路由 —— **一处声明，两处使用**，两边不可能漂移。

**worker 路由：rdf / msd → 条目层，其余 → 形状分发（本环必须写死的判断）**

- 位置：`job_runner.ts` 的 `computeByAnalysisId` 内，一张 readonly 的两条目路由表 `TRAJECTORY_ENTRY_RUNNERS`（形状与 02 环 `result_marshal.ts` 同源：模块级字面量 + 未列出即走默认），默认分支是形状分发。
- **这算不算又一个 id seam：算，而且是最后一个，本环把它当作 seam 显式注册而不是当作 if 顺手写下**。它与 02 环那张表的成因不同，必须分开讲清楚：02 的表补的是"catalog 没有 result 序列化元数据"，这里补的是"catalog 没有轨迹级分析这个概念"。`rdf.radial_distribution` 在 catalog 里是 `frameNeighbors`、`msd.mean_squared_displacement` 是 `accumulate`，纯按形状驱动能跑，但跑出来的是**另一个产品语义**：RDF 会变成逐帧原始直方图列表，丢掉组 B、丢掉 `averageRdfResults` 的帧平均与 counts 求和（RdfPanel 的图表消费的正是 `RdfTrajectoryResult`）；MSD 会丢掉参考帧与 id 跟踪。所以这两个 id 走 `computeRdfTrajectory` / `computeMsdTrajectory`（03 环刚收敛好的条目层），与主线程 RdfPanel / MsdPanel 今天的语义逐字一致。
- 注释契约：表头 jsdoc 写明 (1) 这两条不是"特例"而是"catalog 无法表达的轨迹级语义"；(2) 收缩条件 —— molrs 若提供带组选择的轨迹级 RDF / MSD binding，两条目一并删除、默认分支接管；(3) 禁止在此表新增第三条来"绕过"形状分发不支持的情况 —— 那种情况的正确答案是 `snapshotCoversAnalysis` 返回 false。
- `readRdfParams`（:280）/ `readMsdParams`（:292）作为具名函数消失，函数体成为这两个路由条目的内联 wire 读取。这里要说清楚，否则实现会读偏：RDF 的 `representation` / `volume` / `groupASelection` / `groupBSelection` **不是 catalog 参数**，`coerce` / `ctorArgs` 生不出它们；catalog 驱动的参数强制只服务形状分发那条默认分支。
- `AnalysisWireParams` 保留其 wire 校验职责与 `selection()` reader（`coerce` 无等价物：mask 已在主线程解析成 indices，wire 上是 `{kind}` 判别联合），并新增 `values(definition)`：按 definition 声明的参数键逐个校验为 number / boolean / string（类型不符即失败作业，绝不强转 —— 该模块 :208-213 的既有契约），缺省项省略交给 `coerce` 用 `spec.default` 兜底。产出正是 `AnalysisParamValues`。
- `SnapshotTrajectory`（:56）原位不动，作为 `AnalysisTrajectorySource` 直接喂给 03 环放宽后的两个 runner；`worker_protocol.ts` 的 job payload 形状零改动（`params` 本来就是 `Record<string, unknown>`）。

**可测性**：`shape_dispatch.ts` 的单测可用真 molrs 帧逐形状驱动，不需要 `Trajectory`、不需要 worker、不需要 page；`snapshotCoversAnalysis` 的单测只喂手写 `AnalysisDefinition` 字面量，连 WASM 都不需要。

### Reuse decision

- `dispatch.runSingleFrame` / `coerce` / `ctorArgs` / `callValue` / `callNumber` / `instantiate` / `wasmClass` / `PER_FRAME_KINDS`（:92-315,:496）→ **generalize**：整体迁入 Kernel 模块，服务主线程与 worker 两个调用者；函数体不重写。
- `dispatch.CatalogAccumulator`（03 环加入）→ **generalize**：随形状分发迁入 `shape_dispatch.ts`，两线程共用一个 accumulate 驱动。
- `dispatch.AnalysisParamValues`（:40）→ **generalize**：声明迁入，dispatch 再导出保公共路径。
- `job_runner.SnapshotTrajectory`（:56）→ **reuse**（原位不动，本环只是终于让它驱动通用 runner）。
- `job_runner.AnalysisWireParams.selection()`（:246）→ **reuse**；`readRdfParams` / `readMsdParams`（:280,292）→ **generalize**（函数体内联进路由表条目，具名函数消失）。
- `trajectory_analyses.computeRdfTrajectory` / `computeMsdTrajectory`（:176,:299）→ **reuse**：worker 的 rdf / msd 路由直接调它们，语义与主线程面板一致。
- `trajectory_runner.runTrajectoryFrames` / `runTrajectoryAccumulate`（03 环）→ **reuse**：形状分发的逐帧与 accumulate 两条路径都由它们跑，worker 里不新写循环。
- `result_marshal.marshalAnalysisResult`（02 环）→ **reuse**：形状分发出口统一过它，worker 与主线程拿到同一份 plain data。
- `trajectory_runner.AnalysisUnsupportedError`（02 环迁入）→ **reuse**：形状不支持、requirement 不满足、catalog 无此 id 三种情况全用它，**不造新错误类**。
- `registry.getAnalysisDefinition`（registry.ts:315）/ `isFrameColumnRequirement`（:185）→ **reuse**：worker 自己解析 definition（`getAnalysisCatalog` 已 memoize，且 registry 只依赖 molrs，worker-safe）；覆盖谓词的注释引用 `isFrameColumnRequirement` 的分类。
- `worker_protocol.snapshotFrameForAnalysis`（:250）→ **reuse**（不改）；范围版是 05 环。
- `analysis/panel_inputs.ts` / `algo/neighbor_list` / `analysis/frame_subset.ts` → **reuse** 原样，均已 worker-safe。
- `dispatch.runSeries` / `stackVectorColumns`（:445,:403）→ **new — 显式留在主线程**：它们要的速度列不过 wire，形状上就不可能在 worker 跑；`snapshotCoversAnalysis` 对 `series` 返回 false 正是这条事实的机器可读版本。
- `analysis/requirements.ts` 的可用性探测 → **reuse 原样**：仍是主线程面板前置关卡，worker 不复探（它只做 wire 覆盖判断，两者关注点不同）。

## Files to create or modify

- `stage/src/analysis/shape_dispatch.ts` (new)
- `stage/src/analysis/dispatch.ts`
- `stage/src/analysis/job_runner.ts`
- `stage/src/analysis/worker_protocol.ts`
- `stage/src/analysis/index.ts`
- `stage/src/index.ts`
- `stage/tests/analysis/shape_dispatch.test.ts` (new)
- `stage/tests/analysis/worker_protocol.test.ts`
- `stage/tests/analysis/job_runner.test.ts`
- `regressions/worker-catalog-dispatch-04-dispatch.ts` (new)

## Tasks

- [ ] Write failing unit tests for ShapeDispatch and the snapshot-coverage predicate (stage/tests/analysis/shape_dispatch.test.ts → TestRunSingleFrame; stage/tests/analysis/worker_protocol.test.ts → TestSnapshotCoversAnalysis)
- [ ] Move runSingleFrame, the param coercion helpers, CatalogAccumulator, PER_FRAME_KINDS and AnalysisParamValues into stage/src/analysis/shape_dispatch.ts (new) with jsdoc-tiered docstrings stating why the module is kernel-safe, and re-export AnalysisParamValues from dispatch.ts
- [ ] Add snapshotCoversAnalysis and AnalysisShapeResult to stage/src/analysis/worker_protocol.ts and export both from stage/src/analysis/index.ts and stage/src/index.ts
- [ ] Write failing unit tests for the worker's catalog dispatch (stage/tests/analysis/job_runner.test.ts → TestRunAnalysisJob)
- [ ] Implement catalog inputKind dispatch in computeByAnalysisId with the TRAJECTORY_ENTRY_RUNNERS route table and its seam-contract docstring (stage/src/analysis/job_runner.ts)
- [ ] Add AnalysisWireParams.values(definition) and delete readRdfParams / readMsdParams, keeping the selection() reader
- [ ] Verify shape_dispatch.ts is exported by neither barrel and imports no Main-layer module
- [ ] Add regression example regressions/worker-catalog-dispatch-04-dispatch.ts (public API only for the predicate; hard-coded goldens, no third-party runtime)
- [ ] Run full check + test suite

## Testing strategy

单测只在 `stage/tests/` 下、路径镜像源码；单 unit 绿灯 = `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/<file>.test.ts`。环境 `@rstest/browser` headless chromium + `tests/setup_wasm.ts`，**没有 fs**：所以"不进 barrel / 不 import Main 层"只能是 code 类验收项（grep + 人工），不写成单测。

- `stage/tests/analysis/shape_dispatch.test.ts` → `TestRunSingleFrame`（真 molrs 帧，`setup_wasm`）
  - `frame` 形状：手写一个最小 definition（`wasmExport` 指向真实 molrs 导出）跑通，返回 plain data（无 WASM 句柄字段）。
  - `frameNeighbors` 形状：rdf definition + 两原子周期帧，断言产出对象的 `binCenters` / `numPoints` 等字段来自 02 环的表（证明出口过了 `marshalAnalysisResult`）。
  - `frameClusters` 形状：`shape.center_of_mass` 断言 `centersOfMass` / `clusterMasses` / `numClusters` 三字段齐全（COM 分支已由表接管，dispatch 里没有三元）。
  - 参数强制：`coerce` 的七种 kind 各一个用例（`intList` → `Uint32Array`、`floatList` → `Float64Array`、`textList` 去空白项、非数值抛错并点名 `spec.key`）。
  - 未知形状（`frameGroupSets`）抛 `AnalysisUnsupportedError` 且 `analysisId` 正确。
- `stage/tests/analysis/worker_protocol.test.ts` → `TestSnapshotCoversAnalysis`（**不引入 molrs**：definition 是手写字面量）
  - `requires: []` 的逐帧 / accumulate 形状 → true；`inputKind: "series"` → false；`inputKind: "frameGroupSets"` → false；`requires: ["velocity"]` → false；`requires: ["atomPairs"]` → false；`requires: ["voidMask"]` → true。这六条就是本环声称的覆盖规则的可执行定义。
- `stage/tests/analysis/job_runner.test.ts` → `TestRunAnalysisJob`（扩写；既有 rdf / msd / 三斜盒 / 取消用例**保持不变**并继续绿 —— 它们是"两 ID 路径语义没被改坏"的现成证人）
  - 新增：一个 catalog 里真实存在、`requires` 为空的逐帧分析（如 `cluster.connected_components`）通过 job 跑通，`payload` 是 `AnalysisShapeResult` 形状且 `failures` 里是 `{frameIndex, message}` 而非 Error 实例。
  - 新增：`series` 类分析的 job 抛 `AnalysisUnsupportedError`，消息点名挡住它的 requirement / inputKind。
  - 新增：catalog 里不存在的 id 抛 `AnalysisUnsupportedError`（而不是从前那句 "not available on the worker"）。
  - 新增：进度拍数与 `framesVisited` 在形状分发路径上与 rdf 路径一致（每帧一拍，含失败帧）—— 这是 03 环 ac-005 契约在新路径上的复验。
- 回归样例 `regressions/worker-catalog-dispatch-04-dispatch.ts`：从 `../stage/dist/index.js`（公共 API）取 `snapshotCoversAnalysis`，喂六个手写 definition 断言上面六条判定的硬编码布尔值；再用 `node:fs` 读 `stage/src/analysis/job_runner.ts` 源码断言 `readRdfParams` / `readMsdParams` 已消失、`TRAJECTORY_ENTRY_RUNNERS` 恰有两个条目、且不再包含字符串 `"not available on the worker"`（源码文本断言的先例：`regressions/theme-tab10-ovito-05-page.ts:34-63`）。不加载 WASM、不起 worker、不跑第三方软件。

## Out of scope

- `AnalysisFrameSnapshot` 增列（速度 / 键块 / 任意标签列）—— wire 变更，本链全程不做；它正是 `snapshotCoversAnalysis` 今天返回 false 的那些分析的解锁条件，留作后续 spec。
- 面板改线、`GenericAnalysisPanel` 上 worker、page 侧字面量收敛 —— 06 环。
- `snapshotFramesForAnalysis` 范围版 —— 05 环。
- 主线程 `runAnalysis` 的存废与路由策略（是否强制全部上 worker）—— 保留原样，路由策略变更全链范围外。
- `dispatch.runSeries` / `stackVectorColumns` 的实现 —— 03 环已显式保留，本环不动。
- `panel_inputs.ts` 改名、`requirements.ts` 探测策略、`exploration.ts` —— 全链不动。
