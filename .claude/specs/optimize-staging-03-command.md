---
title: 优化结果作为可撤销命令入编辑池
slug: optimize-staging-03-command
status: code-complete
created: 2026-08-15
---

# 优化结果作为可撤销命令入编辑池

## Summary

`runOptimize` 今天在 job 结束后直接经 `ensureDataSourceAndDraws` 改写 HEAD 并 `applyPipeline({changeKind:"full"})`，用户没有反悔余地，也没有「这是暂存结果」的信号。本条改成：结果坐标（含 worker 新增的氢与键）作为**一条可撤销命令**落入 SceneIndex 编辑池，场景随之变脏并给出持久提示「Optimized — Ctrl+S to save」，落盘由既有的 Ctrl+S → `commitScene` 完成。直发路径整条删除，不留双行为；取消语义不变——最后坐标照样发布，只是发布进工作区。

## Design

新增 `stage/src/commands/optimize_result.ts`：

- `interface OptimizeStagePlan` —— 纯数据、无 molrs 句柄：`{ x, y, z: Float64Array; elements: readonly string[]; bondI, bondJ: Uint32Array; bondType?: Uint32Array; baseAtomCount: number }`。`baseAtomCount` 是优化前画布上的原子数，`elements.length` 是优化后的（补氢后可能更大）。
- `class StageOptimizeResultCommand extends Command<void>`（`<Verb><Noun>Command` 命名族，`stage/src/commands/base.ts` 绑定的 app 基类）
  - 构造：`(app: MolvisApp, plan: OptimizeStagePlan)`。**构造函数不捕获任何场景状态**——快照只在 `do()` 里取（`DeleteAtomCommand` 的形状）。
  - `do()`：
    1. 重做路径：已有 `composite` 且已捕获快照 → 重放（`PlaceMoleculeCommand` 的 redo 形状）。
    2. 捕获：对 `0..baseAtomCount-1` 逐 id 从 `metaRegistry.atoms.getMeta(id).position` 存旧坐标（Å）到 `previousPositions`。
    3. 写新坐标：`EditPoolPositions.writeAtom`（01 的唯一写入口），行 i → logical atom id i。
    4. 增长部分（`elements.length > baseAtomCount`）：预分配 `getNextAtomId()` / `getNextBondId()`，组 `CompositeCommand`（`DrawAtomCommand` × 新增原子 + `DrawBondCommand` × 新增键），`await composite.do()`。
    5. `refreshBondsAround(所有被写原子)` 一次 → `ScenePaintTick.flush()` 一次（内含 `markAllUnsaved` → `dirty-change`）。
  - `undo()`：反向——`composite.undo()` 移除新增原子/键 → 把 `previousPositions` 写回 → `refreshBondsAround` → `flush()` → 返回 `this`。未执行就 `undo()` 抛描述性 `Error`（"…has not been executed"）。
  - **不加 `@command` 装饰器**：注册表 / RPC 路径会丢实例、永不入撤销栈（`base.ts:42-50` 契约）。唯一入口是 `app.commandManager.execute(...)`，因此也**不进** `REGISTERED_COMMAND_CLASSES`、不从 `commands/index.ts` 导出。
  - 铁律遵守：绝不 `applyPipeline`、绝不 `registerAtomFrame` / `setFrameData`（会重置 `frameOffset` 并清空编辑池）、绝不 `promoteFrameToEditPool`（帧段位置写入靠 identity 映射即可，新增实体走 `createAtom`/`createBond`）。

`stage/src/optimize/structure.ts` 改造：

- `runOptimize` 末段替换为 `await app.commandManager.execute(new StageOptimizeResultCommand(app, plan))`。
- 删除 `ensureDataSourceAndDraws`、`buildResultFrame`、`waitForNextEngineFrame` 与 `hasDrawModifiers` / `primaryDataSource` 局部帮手（结果不再造 Frame，也不再碰 DataSource）；晶胞不变，由 commit 时的 `sourceFrame` 带过（02 已保证列与盒都过得去）。
- `UnsavedSceneError` 前置门保留：优化必须从干净 HEAD 出发。
- 暂存后发一条持久行 `app.events.emit("info-text-change", "Optimized — Ctrl+S to save")`（`manipulate.emitStatus` 的形状；瞬时完成播报仍走 `status-message`），因此 VSCode / Python 宿主也拿得到，不只 page。
- `OptimizeOutcome` 形状不变，JSDoc 改写：数字描述的是**暂存进工作区**的几何，不再是"已在管线上画出来的"。

### Reuse decision

| librarian 候选 | 裁决 | 说明 |
|---|---|---|
| `place_molecule.ts` `PlaceMoleculeCommand` | **pattern** | 最近形状：Frame→N 原子 M 键，`do()` 内组 composite、逆序 undo、redo 重放存量 composite |
| `draw.ts` `DeleteAtomCommand` | **pattern** | 捕获/恢复那一半：`do()` 内快照、`async undo()` 恢复 |
| `composite.ts` `CompositeCommand` | **reuse** | 新增原子/键的原子性容器 |
| `base.ts` `Command` / `@command`（+ `core/src/command.ts` execute 路径） | **reuse（且不装饰）** | 只经 `app.commandManager.execute` 才可撤销；本命令非 RPC，故不装饰 |
| `commands/index.ts` `REGISTERED_COMMAND_CLASSES` | **pattern（不适用）** | 无 `@command` ⇒ 无需 pin，也不加导出 |
| `selection.ts` `MoveSelectionCommand` | **pattern（负例）** | 明令不扩展：meshId:instanceIndex 键控、不更新 metaRegistry、零调用点、早于 Canvas-WYSIWYG 规则 |
| `scene_index.ts` `createAtom` / `createBond` / `unregisterEditAtom` / `unregisterEditBond` | **reuse** | 经 `DrawAtomCommand` / `DrawBondCommand` 间接调用，不直调 |
| `artist.ts` `drawAtom` / `drawBond` | **reuse** | 同上（style→buffers→createAtom 一条道） |
| `artist.ts` `drawAtomFromBuffers` / `drawBondFromBuffers` | **reuse** | undo 恢复门（由 `DrawAtomCommand.undo` / `DeleteAtomCommand.undo` 持有） |
| `scene_index.ts` `getNextAtomId` / `getNextBondId` | **reuse** | 预分配连续 id，`PlaceMoleculeCommand` 同法 |
| `EditPoolPositions` / `ScenePaintTick`（01） | **reuse** | 唯一位置写入口与一次性上屏，不另造 |
| `scene_sync.ts` `materializeFrameFromScene` + `AtomColumnCarrier`（02） | **reuse** | Ctrl+S 落盘不丢列，本条据此才敢删直发路径 |
| `scene_index.ts` `renderIndicesForLogicalId` / `markDirty` / `updateAtom` | **reuse** | 经 01 的类间接使用 |
| `scene_index.ts` `updateMulti`/`markAllDirty`、`artist.ts` `refreshAtomPositions` | **pattern（负例）** | 不走 |
| `scene_index.ts` `registerAtomFrame` / `setFrameData` / `promoteFrameToEditPool` | **pattern（负例）** | 命令内明令不调用（会清空编辑池 / 重复提升） |
| dirty 链路 `markAllUnsaved` → `onDirtyChange` → `app.ts:309` `dirty-change`；订阅方 `StructureOptimizePanel.tsx:193` / `LeftSidebar.tsx:161` / `ViewerToolbar.tsx:58` / `unsaved-scene-dialog.tsx:13` | **reuse** | 不改事件，只多一个产脏来源 |
| Ctrl+S：`mode/base.ts:201/:459` + `ViewerToolbar.tsx:92` → `commitScene`（`app.ts:531`） | **reuse** | 与模式无关，一行不改 |
| `manipulate.ts` `emitStatus` → `info-text-change`（`events.ts:21`） | **pattern** | 持久提示行照此形状发 |
| `events.ts:25` `status-message` | **reuse** | 仅承载瞬时完成/错误播报 |
| `structure.ts` `cloneAtomColumns`（已由 02 归并）、`optimize/frame_columns.ts` | **reuse（02 定案）** | 本条删除的是 `buildResultFrame`，不是列搬运 |
| `relax.ts` `OptimizeStep.coords`；`job_runner.ts` `onStep`/`emitStep`；`protocol.ts` `OptimizeStepProgress`/`optimize*TransferList`；`core/src/workload/{worker_side,host}.ts`；`transport/trajectory_worker/protocol.ts`；`compute/worker.ts:76`；`OptimizeJobResult.atomCount` | **defer → 04-live**（`atomCount` 本条即 **reuse**，作为 `plan.elements.length` 的来源） | |
| `StructureOptimizePanel.tsx:342` 文案 | **defer → 05-panel** | 语义反转在 page 侧收口 |

## Files to create or modify

- `stage/src/commands/optimize_result.ts` (new)
- `stage/src/optimize/structure.ts`
- `stage/tests/commands/optimize_result.test.ts` (new)
- `stage/tests/optimize/structure.test.ts`
- `regressions/optimize-staging-03-command.ts` (new)

## Tasks

- [x] Write failing unit tests for StageOptimizeResultCommand (stage/tests/commands/optimize_result.test.ts → TestStageOptimizeResultCommand)
- [x] Implement StageOptimizeResultCommand in stage/src/commands/optimize_result.ts
- [x] Write failing unit tests for staged runOptimize in stage/tests/optimize/structure.test.ts
- [x] Replace the direct HEAD publish in runOptimize with commandManager.execute and delete ensureDataSourceAndDraws / buildResultFrame / waitForNextEngineFrame in stage/src/optimize/structure.ts
- [x] Emit the persistent "Optimized — Ctrl+S to save" line via info-text-change in stage/src/optimize/structure.ts
- [x] Add docstring per jsdoc-tiered covering do/undo symmetry, angstrom units and the no-applyPipeline rule in stage/src/commands/optimize_result.ts
- [x] Add regression example regressions/optimize-staging-03-command.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

`stage/tests/commands/optimize_result.test.ts`，单模块单测，用 fake app 面（fake `sceneIndex` / `artist` / `highlighter` / `commandManager`，无 Babylon、无 molrs）：

- happy：3 原子、plan 坐标 (0.10,0,0)/(0.90,0,0)/(0,0.05,0) → `do()` 后三个 id 的 meta position 命中硬编码值。
- happy：`undo()` 把坐标还原为捕获前的 (0,0,0)/(1,0,0)/(0,0,0)，逐值相等。
- happy：`elements.length = baseAtomCount + 2`（补氢）→ 恰好新增 2 个原子、plan 中新增的键数条；`undo()` 后编辑池原子数回到 `baseAtomCount`。
- edge：未 `do()` 直接 `undo()` → 抛 Error，消息含命令名。
- edge：`do()` 期间 `applyPipeline` / `registerAtomFrame` / `setFrameData` / `promoteFrameToEditPool` 调用次数均为 0。
- edge：`ScenePaintTick.flush` 每次 `do()` / `undo()` 各恰好一次（不是每原子一次）。
- edge：redo（`do()` 第二次）不重复新增原子。

`stage/tests/optimize/structure.test.ts` 扩测：桩掉 worker 客户端返回固定 result → `runOptimize` resolve 后 `sceneIndex.hasUnsavedChanges === true`、`applyPipeline` 未被调用、`info-text-change` 收到字面量 `"Optimized — Ctrl+S to save"`；`cancelled: true` 的 result 同样入池（"取消是停止不是撤销"）；脏场景仍抛 `UnsavedSceneError` 且不触碰编辑池。

回归样例：`regressions/optimize-staging-03-command.ts`，导入 `../stage/dist/commands/optimize_result.js`，对纯对象 fake 场景跑 do → undo → redo，断言上述字面量坐标；并 `readFileSync` `../stage/dist/optimize/structure.js` 断言其中不再出现 `ensureDataSourceAndDraws` 与 `applyPipeline`（双路径已删）。无 WASM、无外部进程。运行：`npm run build:stage` 后 `node regressions/optimize-staging-03-command.ts`。

## Handoff from ring 02 (named, not silent)

两处同族丢列债在 ring 02 出土、超其 scope，路由至此显式记录：
1. `stage/src/commands/frame.ts:50` `ExportFrameCommand` —— 自己的 docstring 声称旧白名单问题已修，但调用 `buildFrameFromScene` 时**不传 `sourceFrame`**，仍在丢列。修法是一个参数（把 System frame 穿进去），但属调用方形状决策——本环若顺手可修（一行 + 一测），否则开后续 spec。
2. `stage/src/io/writer.ts:54` `exportFrame` —— 同病，但签名无源帧入口，修复是 API 变更 → 必须另立 spec，本链不顺手改。

## Out of scope

- molrs 版本升级（另开迁移链）。
- 三斜晶胞支持：`runOptimize` 现有拒绝原样保留。
- `MoveSelectionCommand` 删除：明确不在本条顺手删（零调用点负例），走 `/mol:simplify` 或 `/mol:note` 单独处理。
- RPC / socket 数据源回写：`replaceHeadFrame` 抛错的宿主本来就不该被优化直写；本条把结果改走编辑池后，落盘仍由 `commitScene` 的既有门决定，不为 socket 源开新路。
- 轨迹多帧优化（仍只作用于当前帧）。
- 实时过程可视化（04 承担）。
- 面板文案（05 承担）。
