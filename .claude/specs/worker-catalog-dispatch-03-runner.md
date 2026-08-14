---
title: 轨迹 runner 归一：放宽帧源 + feed 型 accumulate runner
status: done
created: 2026-08-14
---

# 轨迹 runner 归一：放宽帧源 + feed 型 accumulate runner

## Summary

同一段「展开帧范围 → 解析参考帧的跟踪原子 → 逐帧解析索引 → yield → 跑 kernel → 记失败 → 报进度」的循环，眼下在树里手写了三遍（`dispatch.ts:569`、`trajectory_analyses.ts:209`、`trajectory_analyses.ts:319`），而第四份**通用实现早已存在**：`trajectory_runner.ts:353` 的 `runTrajectoryFrames`，只因签名把帧源钉死成具体的 `Trajectory`（:131）而没有一个生产调用方。本环把它放宽为结构化的 `AnalysisTrajectorySource`（:107，worker 的 `SnapshotTrajectory` 已实现该接口），在它旁边加一个建立在它之上的 feed 型 accumulate runner，然后把三处手写循环全部改调这两个 runner —— 收敛后 `stage/src/analysis` 里只剩一个逐帧循环。顺带修掉两处被这次改动暴露的真实缺陷：`missingTrackedAtoms: "throw"` 的 throw 被同一个 try 的 catch 吞掉（文档承诺的"失败整轮"从未发生），以及 `dispatch.runAccumulate` 完全忽略调用方传入的原子选择（面板给了 atom scope，MSD 却按全帧算）。

## Design

**`trajectory_runner.ts` —— 放宽与补齐（本环唯一新增行为的模块）**

- `TrajectoryFrameRunOptions.trajectory` 由 `Trajectory` 放宽为 `AnalysisTrajectorySource`（同文件 :107 已定义的结构化面："有多少帧、第 index 帧是什么"）。具体 `Trajectory` 结构上满足它，既有测试 `stage/tests/analysis/trajectory_runner.test.ts:67-76` 传真 `Trajectory` 不受影响；放宽后本模块的 `Trajectory` import（:3）失去引用，一并删除 —— 于是它的**运行时** import 只剩 `utils/dtype` 与 `utils/yield_ui`（`SelectionMask` 是 type-only），这就是"它可以给 worker kernel 用"的具体验证，而不是一句声明。
- 修 `missingTrackedAtoms: "throw"`：现在的 `throw error`（:392）落在同一个 `try` 里，被 :407 的 `catch` 吞成一次普通 failure，与 `"skip-frame"` 无差别 —— 文档写的"或让整轮失败"从不发生。改为把该判定移出 `try`（先解析、判定，再进 try），使 `"throw"` 真正中断整轮。默认仍是 `"skip-frame"`，RDF / MSD / dispatch 三个新调用方都用默认值，因此这是一次纯粹的"让已有开关名副其实"的修复，不改任何现有调用方的行为。
- 新增 `TrajectoryAccumulateSink<T>`（`feed(frame, atomIndices?): void` + `result(): T`）与 `runTrajectoryAccumulate(options, sink)`。**它建立在 `runTrajectoryFrames` 之上**（visit 回调即 `sink.feed`），因此本模块乃至整个 analysis 目录只保留一个逐帧循环 —— "禁止出现第四个循环"由结构保证，不靠自觉。
  - 喂参规则集中在这里：跟踪选择是整帧（`mode === "all"`）时传 `undefined`，让 kernel 直接吃原帧，不构建 sub-frame；否则传解析后的行索引。这正是 `trajectory_analyses.ts:330` 今天手写的规则。
  - 所有权：sink 由**调用方**构造与释放，runner 只 `feed` / `result`，绝不 `dispose()` 一个不是自己造的句柄持有者（molrs 句柄追踪不变量）。
  - 返回 `TrajectoryAccumulateRunResult<T>`：`value`（= `sink.result()`）+ `fedFrameIndices`（成功喂入的帧，按访问序）+ `frameIndices` / `failures` / `trackedSelection`（透传 `runTrajectoryFrames`）。"喂够了没有"是条目层的判断，runner 不替它决定。
- 进度与取消契约**逐字保持**：每帧一拍（失败帧也算）、拍在 `finally` 里；取消抛 `AnalysisAbortError`。`job_runner.ts:358-370` 靠这两条把 job 内序号映射回源帧号并轮询取消，任何偏差都会静默弄坏 worker 的 `framesVisited` 与 cancel —— 这是本环最高风险面，单列验收项。
- 不进公共 barrel：`runTrajectoryAccumulate` / `TrajectoryAccumulateSink` 只在 stage 内部被两个同目录模块按路径 import，没有宿主调用方，按"第二次真实使用才外扩"不加进 `stage/src/index.ts`，也不必改 01 环的 `analysis/index.ts`（它列名再导出，新增内部符号无需登记）。

**`trajectory_analyses.ts` —— 缩为 RDF / MSD 条目层**

- `computeRdfTrajectory`：改调 `runTrajectoryFrames`，visit 回调只做"这一帧的直方图"（`computeRdf`）。组 A 走 runner 的 `selection`（由它跟踪并给出 `atomIndices`）；组 B 在调用前对参考帧解析一次 `TrackedAtomSelection`，在 visit 闭包里 `resolveTrackedAtomIndices` —— runner 只跟踪一个选择，**不**为了第二组给它加第二个 selection 字段（那是 god-options 的第一步）。`averageRdfResults`（:97）函数体**原样不动**，成为本次运行的 reduce 步骤。不引入"reducer 表"：全树只有一个 reducer，一张单条目表是过早抽象（inline until the second use）；这是对 librarian 措辞的显式收窄。
- `computeMsdTrajectory`：改调 `runTrajectoryAccumulate`，sink 就是 `MsdAnalyzer` —— 它**已经**结构上满足 `TrajectoryAccumulateSink<MsdResult>`（`msd.ts:46` 的 `feed(frame, atomIndices?)` 与 `:68` 的 `result()`），无需适配器、无需改 `msd.ts`。`analyzer.dispose()` 仍由本函数的 `finally` 负责。`< 2` 帧返回 `null` 的两处判断（入口的 `frameIndices.length` 与出口的 `fedFrameIndices.length`）留在条目层。
- 结果：本文件收敛后不再有任何按帧索引的循环（只剩 `averageRdfResults` 内部的按 bin 循环），职责只剩「参数类型 + 每帧算什么 + 怎么合并」。

**`dispatch.ts` —— 两条编排路径改调 runner**

- per-frame 路径（:567-606）整段替换为一次 `runTrajectoryFrames`，visit 回调是现成的 `runSingleFrame`；`AnalysisRunResult.frameIndices`（"实际访问到的帧"）由 `result.results.map(r => r.frameIndex)` 得到，`failures` / `trackedSelection` 直接透传。行为差异两处，均已核对且可接受：取消时抛出的错误由 `Error("Analysis run was aborted")` 变为同消息的 `AnalysisAbortError`（`GenericAnalysisPanel.tsx:207` 按 `/abort/i` 匹配消息，行为不变，且 worker 侧从此能识别为取消）；每帧的 `yieldToUi` 由两次变一次（runner 在 kernel 前让出一次）。
- accumulate 路径（:365-397）改调 `runTrajectoryAccumulate`，并按跨链决策让 **`MsdAnalyzer` 成为唯一的 MSD 驱动**：MSD 用 `new MsdAnalyzer()` 作 sink，payload 取 `analyzer.result().frames`，形状与今天的 `Array<{mean, perParticle}>` **逐字段一致**；其余 accumulate 分析用 dispatch 私有的小类 `CatalogAccumulator`（构造持有 `instantiate(...)` 的 binding，`feed` 在有原子索引时用 `buildAtomSubFrame`（`frame_subset.ts:12`）建子帧并在 `finally` 释放 —— 与 `MsdAnalyzer.feed` 同一规则，`result()` 调 `compute()` 并过 `marshalAnalysisResult`，`dispose()` 释放 binding）。
  - 这修掉一个真实缺陷：今天的 `runAccumulate`（:377）把整帧喂进去，`tracked` 从头到尾没被使用 —— 面板给 accumulate 类分析提供的原子范围被静默丢弃。修复后 accumulate 与 per-frame / series 三条路径对选择的处理一致。
  - 这也带来一处行为放宽：accumulate 从"任一帧出错整轮抛"变为"记 failure 继续"，`AnalysisRunResult.failures` 从此对 accumulate 也可能非空（面板本来就显示 failure 计数）。与 per-frame / RDF / MSD 三条路径取齐。
  - dispatch 仍保留**一处** id 判断：选哪个 accumulate 驱动。catalog 没有"结果由 `results()` 还是 `compute()` 取出"的元数据，所以它和 02 环的表是同一个临时 seam；注释显式指回 `result_marshal.ts` 的契约说明，不假装它不存在。
- `runSeries` / `stackVectorColumns`（:403-441）**保留手写循环**，理由写在代码注释里：它产出的是一整块 `(nFrames × nDof)` 矩阵而非逐帧结果、故意不容错（任一帧缺速度列即整轮失败）、且不发进度拍；用 runner 表达要么改掉它的失败语义，要么往 runner 选项里塞模式开关。这是一次显式保留，不是遗漏。

**02 环表的收缩**：MSD 改由 `MsdAnalyzer` 驱动后，`result_marshal.ts` 的 msd 条目**失去生产者**（`MsdAnalyzer.result()` 自己完成拷列与 free），本环一并删除该条目及其单测用例 —— 这正是该表文档承诺的收缩方向，第一次兑现。

### Reuse decision

- `trajectory_runner.runTrajectoryFrames`（:353）→ **generalize**：帧源类型放宽 + 修好 `missingTrackedAtoms`，从零调用方变成全目录唯一的逐帧循环。
- `trajectory_analyses.averageRdfResults`（:97）→ **reuse**：函数体一字不改，改由 runner 的结果数组驱动。
- `msd.MsdAnalyzer`（msd.ts:38）→ **reuse**：它已结构满足新的 sink 协议，`msd.ts` 本环零改动；同时它成为 MSD 的唯一驱动，`dispatch.ts:365` 的 raw-binding 驱动就此消失。
- `frame_subset.buildAtomSubFrame`（frame_subset.ts:12）→ **reuse**：`CatalogAccumulator.feed` 复用它，与 `MsdAnalyzer.feed:51` 同一条构建/释放路径，不另写子帧构造。
- `trajectory_runner.AnalysisAbortError`（:148）与 02 环迁入的 `AnalysisUnsupportedError` → **reuse**：取消与不支持两类错误都不新建类型。
- `result_marshal.marshalAnalysisResult`（02 环）→ **reuse**：`CatalogAccumulator.result()` 经它出结果；msd 条目在本环删除。
- `trajectory_runner.expandFrameRange` / `resolveTrackedAtomSelection` / `resolveTrackedAtomIndices` → **reuse**（原样，全部由 runner 内部调用；条目层只在解析 RDF 组 B 时直接用一次）。
- `dispatch.coerce` / `ctorArgs` / `instantiate`（:114,150,187）→ **reuse**（原位不动；04 环迁入 `shape_dispatch.ts`）。
- `dispatch.stackVectorColumns` / `runSeries`（:403,:445）→ **new — 显式保留手写循环**，理由见 Design。
- `job_runner.SnapshotTrajectory`（:56）→ **deferred（04 环）**：本环放宽的正是让它能驱动 runner 的那个类型，但接线在 04 环做；本环不改 `job_runner.ts`。
- `worker_protocol.snapshotFrameForAnalysis` / `worker_client.runAnalysisOnWorker` / `panel_inputs.ts` / `requirements.ts` / `cluster_pipeline` 谓词 → **deferred / reuse 原样**（05、06 环或全链不动）。

## Files to create or modify

- `stage/src/analysis/trajectory_runner.ts`
- `stage/src/analysis/trajectory_analyses.ts`
- `stage/src/analysis/dispatch.ts`
- `stage/src/analysis/result_marshal.ts`
- `stage/tests/analysis/trajectory_runner.test.ts`
- `stage/tests/analysis/trajectory_analyses.test.ts` (new)
- `stage/tests/analysis/result_marshal.test.ts`
- `regressions/worker-catalog-dispatch-03-runner.ts` (new)

## Tasks

- [x] Write failing unit tests for the widened frame runner and the missingTrackedAtoms fix (stage/tests/analysis/trajectory_runner.test.ts → TestRunTrajectoryFrames)
- [x] Widen TrajectoryFrameRunOptions.trajectory to AnalysisTrajectorySource, drop the now-unused Trajectory import, and make missingTrackedAtoms "throw" abort the run in stage/src/analysis/trajectory_runner.ts
- [x] Write failing unit tests for runTrajectoryAccumulate (stage/tests/analysis/trajectory_runner.test.ts → TestRunTrajectoryAccumulate)
- [x] Implement TrajectoryAccumulateSink and runTrajectoryAccumulate on top of runTrajectoryFrames in stage/src/analysis/trajectory_runner.ts, with jsdoc-tiered docstrings covering sink ownership and the whole-frame feed rule
- [x] Write failing unit tests for the RDF / MSD entry layer (stage/tests/analysis/trajectory_analyses.test.ts → TestComputeRdfTrajectory, TestComputeMsdTrajectory)
- [x] Rewrite computeRdfTrajectory onto runTrajectoryFrames with averageRdfResults as the unchanged reduce step in stage/src/analysis/trajectory_analyses.ts
- [x] Rewrite computeMsdTrajectory onto runTrajectoryAccumulate with MsdAnalyzer as the sink
- [x] Rewrite the per-frame and accumulate loops of stage/src/analysis/dispatch.ts onto the two runners, add CatalogAccumulator, honour the tracked selection, and drop the producerless msd entry from result_marshal.ts and its case in result_marshal.test.ts
- [x] Add regression example regressions/worker-catalog-dispatch-03-runner.ts (fake trajectory source; hard-coded expectations, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

单测只在 `stage/tests/` 下、路径镜像源码、类型镜像类型；单 unit 绿灯 = `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/<file>.test.ts`。环境 `@rstest/browser` headless chromium + `tests/setup_wasm.ts`，**没有 fs**：因此"只剩一个循环"、"不进公共 barrel"这类结构判据一律走 code 类验收项（人工 / grep），不塞进单测。

- `stage/tests/analysis/trajectory_runner.test.ts`（扩写）
  - `TestRunTrajectoryFrames`：新增用例用**手写的假 `AnalysisTrajectorySource`**（`{ length, frame() }`，帧对象只需 `getBlock("atoms") → { nrows() }`）驱动 —— 这既证明放宽生效，也让这些用例完全不碰 WASM。断言：stride 访问序、visit 抛错时 failures 记一条且 results 少一条、进度拍数等于计划帧数（含失败帧）、`abortSignal` 已触发时 reject 且 `error.name === "AnalysisAbortError"`。
  - 既有 `"runs sampled frames without moving trajectory currentIndex"`（:66-92）**保持不变**并继续绿：真 `Trajectory` 仍满足放宽后的类型，是"没有破坏具体实现"的证人。
  - `missingTrackedAtoms` 两个用例成对：默认 `"skip-frame"` 记 failure 并继续；`"throw"` 让整轮 reject —— 后者今天会失败（throw 被 catch 吞掉），是本次修复的 RED。
  - `TestRunTrajectoryAccumulate`：假源 + 计数 sink，断言 feed 次数与 `fedFrameIndices`、`value` 来自 `sink.result()`、整帧选择时 `feed` 的第二参为 `undefined`、子集选择时为解析后的行索引数组、runner **不**调用 sink 上任何 dispose 类方法。
- `stage/tests/analysis/trajectory_analyses.test.ts`（新，镜像 `src/analysis/trajectory_analyses.ts`）：这两个入口今天没有镜像测试（`rdf.test.ts` 只覆盖单帧 `computeRdf`），而本环重写了它们的驱动 —— 没有测试就没有等价性证据。用真 molrs 帧（`setup_wasm`，与 `rdf.test.ts:1-3` 同惯例）：
  - `TestComputeRdfTrajectory`：两帧同构体系 → `average.gr` 逐 bin 等于两帧手算平均（硬编码期望）、`counts` 是求和而非平均、组 A/组 B 子集选择被逐帧跟踪、一帧坏帧记入 `failures` 且运行继续、全部帧失败时抛出**第一条**失败错误而不是返回 null。
  - `TestComputeMsdTrajectory`：三帧沿 x 平移 → `result.frames[i].mean` 等于硬编码位移平方、`frameIndices` 与喂入序一致、`< 2` 帧返回 null、取消抛 `AnalysisAbortError`、分析器被释放（`dispose` 后再 `result()` 不被调用）。
- `stage/tests/analysis/result_marshal.test.ts`：删除 msd 条目用例（该条目在本环随驱动收敛一并删除）；删除动作写在任务里，不静默。
- `stage/tests/analysis/job_runner.test.ts` 与 `rdf.test.ts` 不改动，继续充当 worker 路径与单帧 RDF 的回归证人：进度拍、`framesVisited`、取消语义若被本次收敛改坏，最先变红的就是 `job_runner.test.ts`。
- 回归样例 `regressions/worker-catalog-dispatch-03-runner.ts`：import `../stage/dist/analysis/trajectory_runner.js`（该模块的 runner 按设计不进公共 barrel，按构建产物深路径钉住，与既有 `theme-tab10-ovito-*` 深路径惯例一致），用假帧源 + 假 sink 驱动两个 runner，断言硬编码的访问序 `[0, 2]`、failures 计数、feed 计数、取消时 `error.name === "AnalysisAbortError"`。纯 JS 对象，不加载 WASM、不调 molrs、不跑第三方软件。

## Out of scope

- worker `computeByAnalysisId` 的 catalog 形状分发、`shape_dispatch.ts`、删除 `readRdfParams` / `readMsdParams` —— 04 环；本环不改 `job_runner.ts` 一行。
- `snapshotFramesForAnalysis` 范围版与面板改线 —— 05 / 06 环。
- `dispatch.stackVectorColumns` / `runSeries` 的手写循环 —— 显式保留（理由见 Design），不在本环收敛，也不标记为待办债。
- `AnalysisDispatchOptions.trajectory` 的公共入参仍是具体 `Trajectory`：`runAnalysis` 是公共 API，放宽它属于公共面变更，本环不做。
- `msd.ts` / `frame_subset.ts` / `rdf.ts` 内部实现 —— 全部原样复用，不改。
- `cluster_pipeline.ts:107` 谓词、`GenericAnalysisPanel.tsx:128-176` 面板短路 —— 跨链锁定为保留。
- molrs 侧 Rust RDF accumulator（能把 RDF 也变成 feed 型 sink 的那一天）—— molrs 仓库，下个发版。
