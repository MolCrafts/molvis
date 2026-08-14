---
title: 分析快照范围版：snapshotFramesForAnalysis
status: done
created: 2026-08-14
---

# 分析快照范围版：snapshotFramesForAnalysis

## Summary

把一个帧范围打包成 worker 作业的快照数组，眼下在 page 里逐字节重复了两遍（`RdfPanel.tsx:489-494` 与 `MsdPanel.tsx:179-184`：展开帧范围 → 逐帧取帧 → `snapshotFrameForAnalysis` → 推入数组，连"轨迹拥有帧，只快照不释放"的注释都一样）。第二个调用点已经存在，扩取门槛（inline until the second use）早已越过，而它缺的落点很明确：`snapshotFrameForAnalysis` 旁边。本环在 `worker_protocol.ts` 加上范围版 `snapshotFramesForAnalysis(trajectory, frameRange)` 并进公共 barrel，让宿主提交一个分析作业时不必自己知道"帧范围怎么展开、帧归谁所有"。本环只加不改：两个面板的替换在 06 环，`snapshotFrameForAnalysis` 与 wire 形状零改动。

## Design

- 新增 `snapshotFramesForAnalysis(trajectory: AnalysisTrajectorySource, frameRange?: FrameRange): Promise<AnalysisFrameSnapshot[]>`，紧邻 `snapshotFrameForAnalysis`（:250）。函数体就是两个面板今天那段循环：`expandFrameRange(trajectory.length, frameRange)` → 逐个 `await trajectory.frame(index)` → `snapshotFrameForAnalysis(frame, index)`。
- 入参用结构化的 `AnalysisTrajectorySource`（`trajectory_runner.ts:107`，早于本链就存在）而不是具体 `Trajectory`：宿主传真轨迹，单测传手写假源，两者都不需要 `System` 图。这也是本函数能在**不 mock 任何东西**的前提下被单测覆盖的原因。
- 所有权写进 jsdoc 并在实现里守住：**帧归轨迹所有 —— 只读、只拷、绝不 free**（molrs 句柄追踪不变量；`snapshotFrameForAnalysis` 的既有注释 :256-259 已是这条规则的先例）。返回的每个快照里的数组都是新的 JS 拷贝，因此可以安全交给 `analysisJobTransferList`（:295）转移 —— 这条也一并写进文档，因为"可转移"正是快照存在的理由。
- 空范围返回空数组，不抛错：`frames.length === 0` / `< 2` 这类判断是**调用方**的产品语义（RdfPanel 说"没有帧产生直方图"，MsdPanel 说"MSD 至少要两帧"），本函数不替它们决定，也不打印任何提示。
- 形态：模块级函数而非类型上的方法 —— 它的自然属主 `Trajectory` 在 Main 层，而快照打包必须留在 Wire 层（Trajectory 不能反向依赖 wire 词汇），且 `snapshotFrameForAnalysis` 已经确立了同一形态；这是 design-preferences 里"真正自由的操作 / 沿用最近的既有形态"那条，不是随手加 helper。
- 进公共 barrel：`stage/src/analysis/index.ts`（Wire 段）与 `stage/src/index.ts`，与 `snapshotFrameForAnalysis`（index.ts:180）并列 —— 它的用户就是宿主面板。
- 本环合并后短暂地没有生产调用方（06 环接线）。这是链条切分的代价，不是死代码：第二个使用点在树里**已经存在两处**，单测立即行使它，06 环删掉那两段重复循环。

### Reuse decision

- `worker_protocol.snapshotFrameForAnalysis`（:250）→ **reuse**：范围版逐帧调用它，不复制它的任何逻辑（列检查、cell 读取、id dtype 校验都只有一份）。
- `trajectory_runner.expandFrameRange`（:168）→ **reuse**：帧范围展开只有一份实现，start/end/stride 的钳制语义与 runner、dispatch 完全一致。
- `trajectory_runner.AnalysisTrajectorySource`（:107）/ `FrameRange`（:15）→ **reuse**（类型原样）。
- `RdfPanel.tsx:489-494` / `MsdPanel.tsx:179-184` 的两段循环 → **generalize**：本环提供落点，06 环删除重复。
- `worker_protocol.analysisJobTransferList`（:295）→ **reuse**（不改；文档里说明范围版产出可直接喂给它）。
- `worker_client.runAnalysisOnWorker` → **deferred（06 环）**：本环不碰提交路径。
- `snapshotCoversAnalysis`（04 环）→ **reuse 语义相邻但不合并**：那是"这个分析能不能被快照表达"，本函数是"把这些帧打包"；两者都在本模块，各自单一职责。
- `analysis/requirements.ts` / `panel_inputs.ts` → **reuse 原样**，不动。

## Files to create or modify

- `stage/src/analysis/worker_protocol.ts`
- `stage/src/analysis/index.ts`
- `stage/src/index.ts`
- `stage/tests/analysis/worker_protocol.test.ts`
- `regressions/worker-catalog-dispatch-05-snapshots.ts` (new)

## Tasks

- [x] Write failing unit tests for snapshotFramesForAnalysis (stage/tests/analysis/worker_protocol.test.ts → TestSnapshotFramesForAnalysis)
- [x] Implement snapshotFramesForAnalysis in stage/src/analysis/worker_protocol.ts with a jsdoc-tiered docstring stating frame ownership (never free) and transferability
- [x] Export snapshotFramesForAnalysis from stage/src/analysis/index.ts and stage/src/index.ts next to snapshotFrameForAnalysis
- [x] Add regression example regressions/worker-catalog-dispatch-05-snapshots.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

单测只在 `stage/tests/` 下、路径镜像源码；单 unit 绿灯 = `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/worker_protocol.test.ts`。环境 `@rstest/browser` headless chromium + `tests/setup_wasm.ts`，**没有 fs**。

- `stage/tests/analysis/worker_protocol.test.ts` → `TestSnapshotFramesForAnalysis`（真 molrs 帧构造，与该文件既有用例同惯例；轨迹侧用**手写假源** `{ length, frame() }`，因此不需要 `System` / `Trajectory`）
  - happy path：四帧假源 + `{start:0, endInclusive:3, stride:2}` → 返回两个快照，`frameIndex` 依次为 `0` 与 `2`（源编号透传，不是 0/1），坐标数组内容等于对应帧的硬编码坐标。
  - 边界：空轨迹（`length: 0`）返回空数组、不抛；`start > endInclusive` 返回空数组；不传 `frameRange` 覆盖全部帧。
  - 所有权：断言函数返回后源帧仍可读（再次 `getBlock("atoms")?.nrows()` 成功）—— 即实现没有 free 任何一帧；这是本函数最重要的一条不变量，必须由测试而不是注释守住。
  - 拷贝性：修改返回快照的 `x[0]` 不影响源帧的坐标列（快照是 JS 堆拷贝，可安全转移）。
  - 逐帧委托：一个缺 `element` 列的帧让整次调用抛错并点名帧号（错误来自 `snapshotFrameForAnalysis`，证明没有第二份列校验实现）。
- 已有的 `snapshotFrameForAnalysis` 用例不改动 —— 本环只加不改，它们是"单帧路径未受影响"的证人。
- 回归样例 `regressions/worker-catalog-dispatch-05-snapshots.ts`：从 `../stage/dist/index.js`（公共 API）取 `snapshotFramesForAnalysis` 与 `expandFrameRange`，用手写假源（帧对象只需 `getBlock("atoms")` 返回带 `dtype` / `copyColF` / `copyColStr` / `nrows` 的假 block，`box` 为 undefined）跑一次 stride 2 的范围，断言硬编码的 `frameIndex` 序列 `[0, 2]`、快照条数 2、`x` 数组内容与源一致、源帧上没有被调用过任何 `free`。纯 JS 对象：不加载 WASM、不调 molrs、不跑第三方软件。

## Out of scope

- 两个面板改用本函数、`GenericAnalysisPanel` 上 worker、page 侧字面量收敛 —— 06 环。
- `AnalysisFrameSnapshot` 增列（速度 / 键块）—— 全链不做（见 04 环 Out of scope）。
- `snapshotFrameForAnalysis` 的实现、`analysisJobTransferList`、job payload 形状 —— 一律不改。
- 帧范围以外的打包策略（分块提交、流式提交、LRU 复用）—— 本函数一次性物化整个范围，与两个面板今天的行为一致；改成分块是另一个 spec 的产品决策。
- 主线程 `runAnalysis` 入口与路由策略 —— 全链范围外。
