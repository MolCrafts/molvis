---
title: 优化面板文案随暂存语义反转
slug: optimize-staging-05-panel
status: approved
created: 2026-08-15
---

# 优化面板文案随暂存语义反转

## Summary

优化结果改为暂存后，面板上「保存」这个词的含义整个翻了个面：运行**之前**的 "Save scene before optimizing" 说的是"先把你自己的画布编辑落盘"，运行**之后**要说的是"优化结果还在工作区，Ctrl+S 才落盘"。本条把这两句以及暂存态摘要收进一个无 React 依赖的纯文案模块，面板改用它；同时把既有进度条布线钉死在测试里，确认 UFF/soft 两条内核路径都能推动它。

> **落盘前审计修正（2026-08-15）**：面板的 step 进度映射带 `Math.min(98, …)` 封顶（`StructureOptimizePanel.tsx` `onProgress` 分支）——运行中进度最高 98，100 留给完成态。进度条断言按「0 → 50 → ≥98」写，不得写 100。

## Design

- 新增 `page/src/lib/optimize-staging-copy.ts`（纯字符串与纯函数，零 React、零 stage 运行时依赖，因此可单测也可被回归脚本直接读）：
  - `OPTIMIZE_SAVE_HINT = "Optimized — Ctrl+S to save"` —— 与 stage 侧 `info-text-change` 发的持久行**同一字面量**（一处定义、两处对齐，靠回归脚本比对）。
  - `OPTIMIZE_DIRTY_GATE_HINT = "Save or discard your canvas edits before optimizing"` —— 取代 `StructureOptimizePanel.tsx` 的 "Save scene before optimizing"：现在"未保存"既可能是用户的编辑，也可能是上一次优化的暂存结果，文案必须指明是**你的画布编辑**。
  - `optimizeStagedLine(outcome: { steps: number; maxForce: number; converged: boolean; cancelled: boolean; hydrogensAdded: number }): string` —— 把既有三分支（converged / max steps / cancelled）+ `+N H` 后缀收成一个纯函数，末尾恒接 `OPTIMIZE_SAVE_HINT`。
- `page/src/ui/layout/StructureOptimizePanel.tsx`：`UnsavedSceneError` 分支改用 `OPTIMIZE_DIRTY_GATE_HINT`；完成分支改用 `optimizeStagedLine(outcome)`；既有 `dirty-change` 订阅（`:193`）不改——它现在会在优化结束后翻成 true，正好驱动"未保存"提示。进度条布线（`onProgress` → `setProgress`）保持原样，只补测试。
- 不新增面板控件、不加"Save now"按钮：Ctrl+S 与工具栏保存已是全局路径（`mode/base.ts` + `ViewerToolbar.tsx` → `commitScene`），面板再放一个就是第二条落盘路径。

### Reuse decision

| librarian 候选 | 裁决 | 说明 |
|---|---|---|
| `StructureOptimizePanel.tsx:342` "Save scene before optimizing" | **generalize** | 语义反转后由 `OPTIMIZE_DIRTY_GATE_HINT` 取代，并与暂存提示区分开 |
| `StructureOptimizePanel.tsx:193` `dirty-change` 订阅 | **reuse** | 一行不改，只是多了一个产脏来源 |
| `events.ts:25` `status-message`（瞬时） | **reuse** | 完成/错误播报仍走它 |
| `manipulate.ts` `emitStatus` → `info-text-change`（`events.ts:21`）持久行 | **reuse** | 持久提示由 stage 侧（03）发；page 只保证字面量一致，不重复发 |
| Ctrl+S：`mode/base.ts:201/:459` + `ViewerToolbar.tsx:92` → `commitScene`（`app.ts:531`） | **reuse** | 不加第二条落盘入口 |
| 其他 `dirty-change` 订阅方 `LeftSidebar.tsx:161` / `ViewerToolbar.tsx:58` / `unsaved-scene-dialog.tsx:13` | **reuse（不改）** | 暂存结果本就应触发它们的未保存提示 |
| `StageOptimizeResultCommand`（03）与 `OPTIMIZE_SAVE_HINT` 字面量 | **reuse** | page 侧复用同一字符串，回归脚本比对两处一致 |
| `OptimizeLivePaint` / `OptimizeCoordsProgress`（04） | **reuse（无 UI 面）** | 实时绘制不经面板；面板只保留既有 step 进度条 |
| `EditPoolPositions` / `ScenePaintTick`（01）；`AtomColumnCarrier` / `materializeFrameFromScene`（02） | **reuse（不直接调用）** | page 不碰 stage 内部 |
| `scene_index.ts` 系列（`renderIndicesForLogicalId` / `markDirty` / `updateAtom` / `updateMulti` / `createAtom` / `createBond` / `getNextAtomId` / `getNextBondId` / `registerAtomFrame` / `setFrameData` / `promoteFrameToEditPool`）；`artist.ts` 系列（`drawAtom` / `drawBond` / `drawAtomFromBuffers` / `drawBondFromBuffers` / `refreshAtomPositions`） | **pattern（负例：page 不得直调）** | 宿主只经 stage 公共 API，不 reach-through |
| `place_molecule.ts` / `draw.ts` / `composite.ts` / `base.ts` / `commands/index.ts` | **defer → 03-command（已定案）** | |
| `selection.ts` `MoveSelectionCommand` | **pattern（负例）** | 不扩展、不引用 |
| `relax.ts` / `job_runner.ts` / `protocol.ts` / `core/src/workload/*` / `transport/trajectory_worker/*` / `compute/worker.ts:76` | **defer → 04-live（已定案）** | page 不碰 wire |
| `structure.ts` `cloneAtomColumns` / `optimize/frame_columns.ts` | **reuse（02 定案）** | |

## Files to create or modify

- `page/src/lib/optimize-staging-copy.ts` (new)
- `page/src/ui/layout/StructureOptimizePanel.tsx`
- `page/tests/lib/optimize-staging-copy.test.ts` (new)
- `page/tests/ui/layout/StructureOptimizePanel.test.tsx`
- `regressions/optimize-staging-05-panel.ts` (new)

## Tasks

- [ ] Write failing unit tests for optimizeStagedLine (page/tests/lib/optimize-staging-copy.test.ts → TestOptimizeStagingCopy)
- [ ] Implement the copy module in page/src/lib/optimize-staging-copy.ts
- [ ] Write failing unit tests for the inverted panel copy in page/tests/ui/layout/StructureOptimizePanel.test.tsx
- [ ] Replace the panel's save-gate and completion copy in page/src/ui/layout/StructureOptimizePanel.tsx
- [ ] Verify the progress bar advances from step beats for both uff and soft in page/tests/ui/layout/StructureOptimizePanel.test.tsx
- [ ] Add docstring per jsdoc-tiered to page/src/lib/optimize-staging-copy.ts
- [ ] Add regression example regressions/optimize-staging-05-panel.ts (public API only; hard-coded goldens, no third-party runtime)
- [ ] Run full check + test suite

## Testing strategy

- `page/tests/lib/optimize-staging-copy.test.ts`（纯函数单测，无 DOM）：
  - happy：`{ steps: 37, maxForce: 0.041, converged: true, cancelled: false, hydrogensAdded: 0 }` → `"Optimized in 37 steps · max |F| 0.041 — Ctrl+S to save"`（硬编码全串比对）。
  - edge：`converged: false` → "stopped at max steps (200)" 分支，仍以 `OPTIMIZE_SAVE_HINT` 收尾。
  - edge：`cancelled: true` → "cancelled" 分支，仍以 `OPTIMIZE_SAVE_HINT` 收尾（取消也已暂存）。
  - edge：`hydrogensAdded: 4` → 串中含 `+4 H`。
  - edge：`OPTIMIZE_DIRTY_GATE_HINT` 不含 "before optimizing" 以外的歧义词，且与 `OPTIMIZE_SAVE_HINT` 不相等。
- `page/tests/ui/layout/StructureOptimizePanel.test.tsx`（扩测，既有 React harness）：桩 `runOptimize` 抛 `UnsavedSceneError` → 面板出现 `OPTIMIZE_DIRTY_GATE_HINT`，旧串 "Save scene before optimizing" 不出现；桩其 resolve → 面板出现 `optimizeStagedLine(outcome)`；桩 `onProgress` 连发 step 节拍（potential 分别为 `uff` 与 `soft`）→ 进度条百分比从 0 变到 50 再到 **≥98**（运行中封顶 98——`Math.min(98, …)`；100 留给完成态；进度条真的会被推动，不是死布线）。
- 回归样例：`regressions/optimize-staging-05-panel.ts`（照 `regressions/theme-tab10-ovito-05-page.ts` 的 page 侧惯例：源文件 `readFileSync` + 字面量断言）：断言 `page/src/lib/optimize-staging-copy.ts` 含字面量 `Optimized — Ctrl+S to save`；断言 `page/src/ui/layout/StructureOptimizePanel.tsx` 不再含 `Save scene before optimizing` 且 import 了该模块；断言 stage 侧同一字面量存在于 `../stage/dist/optimize/structure.js`（两处文案对齐锁）。无 React 渲染、无 WASM、无外部进程。运行：`npm run build:stage` 后 `node regressions/optimize-staging-05-panel.ts`。

## Out of scope

- molrs 版本升级（另开迁移链）。
- 三斜晶胞支持（现有拒绝保持）。
- `MoveSelectionCommand` 删除（走 `/mol:simplify` 或 `/mol:note`）。
- RPC / socket 数据源回写。
- 轨迹多帧优化。
- 面板内新增"Save now"按钮或第二条落盘路径。
- 中文/多语言文案：本仓库 UI 文案统一英文，不在本条引入 i18n。
- VSCode / Python 宿主的等价提示：stage 侧 `info-text-change` 已经覆盖，宿主 UI 另议。
