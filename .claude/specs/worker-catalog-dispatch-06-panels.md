---
title: 面板归一：Generic 上 worker、快照循环收敛、id 常量收敛
status: done
created: 2026-08-14
---

# 面板归一：Generic 上 worker、快照循环收敛、id 常量收敛

## Summary

分析面板里唯一还在主线程跑 molrs 的是 `GenericAnalysisPanel.tsx:180` 的 `runAnalysis`（RdfPanel / MsdPanel 早已走 `runAnalysisOnWorker`）—— 04 环之后 worker 已经能跑整个 catalog 的逐帧与 accumulate 形状，这条落差可以合上了。本环把 Generic 面板的提交路径改成"能上 worker 的上 worker"，路由判据用 04 环那个唯一的 `snapshotCoversAnalysis` 谓词（快照带不动速度列的 series 类分析继续留在主线程，产品能力不回退）；把 RdfPanel / MsdPanel 那两段逐字节重复的快照循环换成 05 环的 `snapshotFramesForAnalysis`；把三处**分发身份**用途的 catalog id 字面量换成 stage 公共 barrel 导出的常量。COM / Rg 的面板短路与 `useAnalysisCatalog` / `molpy-docs` 的展示查表按跨链锁定决策保留，理由写进代码与本文；主线程 `runAnalysis` 同样保留 —— 它是公共 API，且仍是未覆盖分析的实际执行路径。

## Design

**路由决策独立成 `page/src/ui/layout/analysis/analysisRunPlan.ts`（新）**

- 导出 `planAnalysisRun(definition): AnalysisRunPlan`，返回 `{ route: "pipeline" | "worker" | "main" }`：
  - `pipeline` —— `isComAnalysisId(id) || isRgAnalysisId(id)`（`cluster_pipeline.ts:107,111`）。
  - `worker` —— `snapshotCoversAnalysis(definition)`（04 环）。
  - `main` —— 其余（今天主要是 `series` 形状的速度类分析：VACF / Einstein 扩散 / 功率谱等，快照不带 `vx/vy/vz`）。
- 独立成模块的理由是可测性：面板组件测试在 page 的 browser 环境里跑真 React，而 `setComputeRuntimeForTests` 只在 stage 内部可见（`stage/src/index.ts:297` 只再导出 `warmComputeWorker`），page 无法注入假 worker 宿主，也**不应该**为了测试去扩 stage 公共面。把"选哪条路"这个纯决策抽出来，它就能被一个不碰 React、不碰 worker、不碰 WASM 的单测穷举 —— 这正是 design-preferences "当单测必须瞄准这个单元时就抽出来"那一条。
- 顺序是产品语义：pipeline 判定在最前，因为 COM / Rg 即使能被快照表达，也**不该**走 worker（下一条）。

**COM / Rg 短路保留（`GenericAnalysisPanel.tsx:128-178`），理由写进代码注释**

它不是"在主线程算分析"，而是：装 `ensureCenterOfMassModifier` / `ensureRadiusOfGyrationModifier` → `applyPipeline({fullRebuild:true})` 让画布真的画出来 → 读回同一帧的 `cluster_N` 掩膜出表。搬上 worker 会让 worker 内部用自己的 `Cluster` 重算一套簇，于是表里的簇与画布上的簇来自两个真值来源 —— 直接违反 Canvas WYSIWYG = SceneIndex 不变量。因此 `plan.route === "pipeline"` 时短路整段保留，注释指向本 spec 与该不变量。

**worker 路径（`plan.route === "worker"`）**

- 帧打包：`snapshotFramesForAnalysis(app.system.trajectory, frameRange)`（05 环），面板不再自己展开帧范围。
- 原子选择：`wireAtomSelection(selection)`（`selectionOptions.ts:26`）—— 面板的 `selection` prop 可能是活的 `SelectionMask`，不能过 `postMessage`；两个既有面板已经这么做，第三个沿用同一函数，不新写。
- 参数：`AnalysisParamValues` 本身就是 `number | boolean | string` 的记录，原样进 `AnalysisJobPayload.params`；04 环的 `AnalysisWireParams.values(definition)` 在 worker 侧校验。
- 结果：`AnalysisShapeResult`（04 环）→ 面板 `RunState`：`payload = value`、`perFrame`、`frameIndices`、`failures = failures.length`。`RunState` 的字段与今天完全一致，因此帧滑块、`ResultView`、stale 指纹逻辑一行都不用改。
- 取消：`runAnalysisOnWorker` 用 `shouldCancel` 轮询（协作式），而今天的 Generic 面板用 `AbortController`。保留 `abortRef` 作为面板自身的"这次运行已作废"标志（切换分析、重复点击 Run 时用），另加一个 `cancelRef` 供 `shouldCancel` 读 —— 与 RdfPanel `cancelRef`（:477,:520）/ MsdPanel（:171,:202）同形。取消后的 UI 语义不变：回到 `idle`，不写入结果、不动 stale 指纹。
- 冷启动：`warmComputeWorker()` 在面板挂载时预热，与 RdfPanel:333 / MsdPanel:152 同形；失败吞掉，首个 Run 时再报。

**主线程路径保留（`plan.route === "main"`）**

`runAnalysis`（`stage/src/index.ts:79`）**保留**，本环之后仍有唯一调用方 —— 就是这条 `main` 路由（速度类 series 分析）。即使将来快照增列让 `main` 路由清零，它也是公共 API（宿主 / 插件可调），删除属于公共面变更 + 路由策略变更，两者都在本链范围外。**不得**在实现时把它当死代码清掉；本 spec 有一条验收项专门守这件事。

**id 字面量收敛（仅分发身份用途）**

- `RdfPanel.tsx:56`、`MsdPanel.tsx:39` 的局部常量与 `LeftSidebar.tsx:66-81` 的 `PANEL_ANALYSIS_IDS` / `OWNS_ATOM_SCOPE` 两个集合改用 stage 公共 barrel 导出的 id 常量（01 环）。
- `useAnalysisCatalog.ts:48-69`（展示名）与 `molpy-docs.ts:34-58`（文档路径）的 record key **保留字面量**：它们是覆盖整个 catalog 的查表，key 是数据而非分发身份；改成计算键会让整张表不可读，并把只有展示意义的 id 拖进常量模块。这是跨链锁定决策，注释在两处各写一行，避免下一个人以为是漏改。

### Reuse decision

- `worker_client.runAnalysisOnWorker`（worker_client.ts:76）→ **reuse**：Generic 面板用与 Rdf / Msd 面板完全相同的提交入口，不新写 worker 适配。
- `worker_protocol.snapshotFramesForAnalysis`（05 环）→ **reuse**：三个面板共用一个打包函数，`RdfPanel.tsx:489-494` 与 `MsdPanel.tsx:179-184` 的重复循环删除。
- `worker_protocol.snapshotCoversAnalysis`（04 环）→ **reuse**：路由谓词只有一处声明，worker 与面板共用（不在 page 侧重写覆盖规则）。
- `selectionOptions.wireAtomSelection`（:26）→ **reuse**：第三个调用点，函数不改。
- `cluster_pipeline.isComAnalysisId` / `isRgAnalysisId`（:107,:111）→ **reuse**：作为 `planAnalysisRun` 的 pipeline 判定，谓词原样。
- `analysis_ids` 的 id 常量（01 环）→ **reuse**：page 三处分发身份改用它们。
- `dispatch.runAnalysis`（:511）→ **reuse（保留）**：`main` 路由的执行路径 + 公共 API；不删、不改签名。
- `GenericAnalysisPanel` 的 COM / Rg 短路（:128-178）+ `computeClusterMaskProperties` / `readClusterMask` / `ensure*Modifier` → **reuse（保留原位）**，理由见 Design（Canvas WYSIWYG）。
- `useAnalysisCatalog.ANALYSIS_DISPLAY_LABELS`（:48）/ `molpy-docs.ANALYSIS_DOC_PATH`（:34）→ **new — 显式保留字面量 key**，理由见 Design。
- `AnalysisRunBar` / `ResultSection` / `ResultView` / `AnalysisParamsForm` / `AnalysisPanelShell`（同目录）→ **reuse 原样**：本环不碰 UI 结构，`RunState` 字段不变正是为了不惊动它们。
- `requirements.ts` 的可用性探测（面板前置关卡 `blockedReason`）→ **reuse 原样**：仍在主线程跑，worker 不复探（04 环已定）。
- `page/tests/react_harness.ts`（:27 `mountComponent`）→ **reuse**：组件测试沿用既有 harness，不引入 test-library。

## Files to create or modify

- `page/src/ui/layout/analysis/analysisRunPlan.ts` (new)
- `page/src/ui/layout/analysis/GenericAnalysisPanel.tsx`
- `page/src/ui/layout/analysis/RdfPanel.tsx`
- `page/src/ui/layout/analysis/MsdPanel.tsx`
- `page/src/ui/layout/LeftSidebar.tsx`
- `page/src/ui/layout/analysis/useAnalysisCatalog.ts`
- `page/src/lib/molpy-docs.ts`
- `page/tests/ui/layout/analysis/analysisRunPlan.test.ts` (new)
- `page/tests/ui/layout/analysis/GenericAnalysisPanel.test.tsx`
- `regressions/worker-catalog-dispatch-06-panels.ts` (new)

## Tasks

- [x] Write failing unit tests for AnalysisRunPlan (page/tests/ui/layout/analysis/analysisRunPlan.test.ts → TestPlanAnalysisRun)
- [x] Write failing component tests for the worker-routed GenericAnalysisPanel (page/tests/ui/layout/analysis/GenericAnalysisPanel.test.tsx)
- [x] Implement planAnalysisRun in page/src/ui/layout/analysis/analysisRunPlan.ts (new) on snapshotCoversAnalysis plus isComAnalysisId / isRgAnalysisId, with a jsdoc-tiered docstring for the three routes
- [x] Route GenericAnalysisPanel's execute() through planAnalysisRun, submitting worker runs via runAnalysisOnWorker + snapshotFramesForAnalysis + wireAtomSelection, keeping runAnalysis for the main route and keeping the documented COM / Rg pipeline short-circuit
- [x] Replace the snapshot loops in RdfPanel.tsx and MsdPanel.tsx with snapshotFramesForAnalysis
- [x] Replace the catalog id literals in RdfPanel.tsx, MsdPanel.tsx and LeftSidebar.tsx with the stage id constants
- [x] Verify runAnalysis stays exported and referenced, and add the one-line comments that keep useAnalysisCatalog.ts and molpy-docs.ts record keys literal on purpose
- [x] Add regression example regressions/worker-catalog-dispatch-06-panels.ts (source-text locks; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

page 的单测环境是 `@rstest/browser` headless chromium + `pluginReact`（`page/rstest.config.ts`），组件用 `page/tests/react_harness.ts` 的 `mountComponent` 挂真 React DOM；**没有 fs**，且**不能注入假 compute 宿主**（`setComputeRuntimeForTests` 未出现在 stage 公共 barrel，而扩公共面只为测试是错的方向）。因此分工是：路由决策由纯函数单测穷举，面板只测不触发 worker 的可见状态。单 unit 绿灯 = `npm run build:stage && npm run build:engines && npm run test -w page -- tests/ui/layout/analysis/<file>`（page 依赖已构建的 stage dist）。

- `page/tests/ui/layout/analysis/analysisRunPlan.test.ts` → `TestPlanAnalysisRun`（无 React、无 worker、无 WASM；definition 全是手写字面量）
  - `shape.center_of_mass` / `shape.cluster_properties` → `"pipeline"`（即使它们能被快照表达，也必须走管线 —— 顺序敏感，单独一条用例）。
  - `requires: []` 的逐帧 / accumulate 分析 → `"worker"`。
  - `inputKind: "series"`、`requires: ["velocity"]`、`inputKind: "frameGroupSets"` → `"main"`。
  - `rdf.radial_distribution` / `msd.mean_squared_displacement` → `"worker"`（它们有专属面板，但 Generic 面板的路由判据不该对它们例外 —— 锁住这一点，防止有人把 id 特例塞回 page）。
- `page/tests/ui/layout/analysis/GenericAnalysisPanel.test.tsx`（扩写；既有 "title-only empty state" 用例保持不变并继续绿）
  - `app: null` + 一个 `"worker"` 路由的 definition：Run 按钮 disabled、空态标题仍是 `No result yet`（改线不得改动空态文案 —— `.claude/notes/compute-form-design.md` 的 ac-002）。
  - 一个 `"series"` 路由的 definition：空态标题为 `No series yet`（`isSeriesLike` 逻辑未被路由改动波及）。
  - 组件测试**不点击 Run**：那会真的去拿 compute 宿主。"提交路径正确"由 ac-003 的源码级验收项 + analysisRunPlan 单测共同保证，不靠假 worker 演一遍 —— 本仓库没有 e2e 通道，也不为一次断言引入一条。
- RdfPanel 无既有组件测试；MsdPanel 已有一个轻量组件测试（`page/tests/ui/layout/analysis/MsdPanel.test.tsx`，随 ac-009 全量绿保持不被改坏）。本环不为两者新增组件测试：它们的改动是把六行循环换成一次调用，行为等价性由 05 环 `snapshotFramesForAnalysis` 的单测 + 本环回归脚本的源码锁共同覆盖；为它们补组件测试等于要能注入假 worker，属于另一件事（并且要先决定是否扩 stage 的测试注入面）。这条是显式判断，不是遗漏。
- 回归样例 `regressions/worker-catalog-dispatch-06-panels.ts`（沿用 `regressions/theme-tab10-ovito-05-page.ts:34-63` 的 `node:fs` 源码锁先例，因为 page 组件无法在 node 里实例化）：
  - 读 `page/src/ui/layout/analysis/GenericAnalysisPanel.tsx`：断言含 `runAnalysisOnWorker`、`snapshotFramesForAnalysis`、`planAnalysisRun`、`wireAtomSelection`，**仍含** `runAnalysis`（main 路由保留）与 `isComAnalysisId`（管线短路保留）。
  - 读 `RdfPanel.tsx` / `MsdPanel.tsx`：断言不再含 `expandFrameRange(`、含 `snapshotFramesForAnalysis`，且不再含字面量 `"rdf.radial_distribution"` / `"msd.mean_squared_displacement"`。
  - 读 `LeftSidebar.tsx`：断言两个集合不再含上述字面量。
  - 读 `useAnalysisCatalog.ts` 与 `molpy-docs.ts`：断言**仍含**字面量 key（锁定"故意保留"，防止后续被当作漏改改掉）。
  - 从 `../stage/dist/index.js` 取 id 常量，断言其值等于硬编码字面量（与 01 环回归同一批 goldens，来源：molrs compute catalog 0.13.1，2026-08-14），确保 page 引用的常量名确实解析到这些字符串。
  - 输出 `worker-catalog-dispatch-06-panels ok`。不加载 WASM、不起 worker、不跑第三方软件。

## Out of scope

- 把全部分析强制上 worker / 删除主线程 `runAnalysis` —— 路由策略变更 + 公共面变更，全链范围外；本环明确保留 `main` 路由。
- `AnalysisFrameSnapshot` 增列以让 series 类分析也能上 worker —— 全链不做（04 环 Out of scope 已述），也正因如此 `main` 路由今天不是空的。
- COM / Rg 面板短路的重构或搬迁 —— 跨链锁定为保留（Canvas WYSIWYG 不变量）。
- `useAnalysisCatalog.ts` / `molpy-docs.ts` 的 record key —— 跨链锁定为保留字面量。
- RdfPanel / MsdPanel 的组件测试、`setComputeRuntimeForTests` 的公共化 —— 见 Testing strategy 的显式判断，属于另一个 spec。
- `AnalysisRunBar` / `ResultView` / 空态文案 / 面板布局 —— 本环不碰 UI 结构。
- `panel_inputs.ts` 改名、`exploration.ts`、`requirements.ts` 探测策略 —— 全链不动。
