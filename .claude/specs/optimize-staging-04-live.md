---
title: 优化过程实时可视化
slug: optimize-staging-04-live
status: approved
created: 2026-08-15
---

# 优化过程实时可视化

## Summary

worker 的两条内核路径其实每 `reportEvery` 步都已经握着活的坐标缓冲（`OptimizeStep.coords`），但 `job_runner` 的 `onStep` 只转标量、把坐标留在 worker 里，于是一次大体系优化在界面上就是一条不动的进度条（用户在 9N8O.cif 上报的「spinner 不转、界面无显示」）。本条让进度节拍额外携带一份**自有拷贝**的中间坐标，主线程把它按 logical id 写进编辑池的 GPU 缓冲，做 position-only 更新——分子实时松弛是主反馈。

## Design

**Wire（`stage/src/optimize/protocol.ts`）**：新增第三个变体

```ts
export interface OptimizeCoordsProgress {
  kind: "coords";
  step: number;
  maxSteps: number;
  /** Packed xyz (Å), length 3·atomCount. An owned copy — never the kernel's live buffer. */
  coords: Float64Array;
  atomCount: number;
}
export type OptimizeProgress =
  | OptimizeStatusProgress | OptimizeStepProgress | OptimizeCoordsProgress;
```

**刻意不加 `optimizeProgressTransferList()`，坐标走结构化克隆而不是转移**，两条硬理由写进 JSDoc：`core/src/workload/worker_side.ts` 的 `reportProgress(progress: unknown)` 没有 transfer 参数；且它的心跳会**原样重发最后一条 progress**，转移过的缓冲已 detach，重发即抛。这与 `stage/src/compute/worker.ts` 分析结果「宁可拷贝不要猜缓冲」的既有决定同源。`core/` 因此**一行不改**。

**Kernel（`stage/src/optimize/job_runner.ts`）**：`onStep`（现有落点，注释写着 "coords stay here"）在 `emitStep` 之外再发一条 `kind: "coords"`，`coords: new Float64Array(step.coords)` —— 必须是拷贝，因为 `OptimizeStep.coords` 就是内核**原地 mutate** 的那块缓冲，心跳晚些重发时它已经变了。分段循环结构不动，`reportEvery` 仍是唯一节流阀。不新增「一次性拓扑节拍」：实时绘制只画画布上已有的原子（见下），补出来的氢在 03 的暂存命令里一次性落地，所以拓扑不需要提前上线。

**Main（`stage/src/optimize/worker_client.ts`）**：`OptimizeOnWorkerCallbacks` 增 `onCoords?(beat: OptimizeCoordsProgress): void`，`handleOptimizeProgress` 加一路分发；类型从 `stage/src/optimize/index.ts` 导出（Wire 层本来就公开）。

**Main（新 `stage/src/optimize/live_paint.ts`）**：

- `class OptimizeLivePaint`
  - 构造：`(positions: EditPoolPositions, tick: ScenePaintTick, liveAtomCount: number)` —— 01 的两个单元 + 本次运行开始时画布上的原子数。
  - `paint(beat: OptimizeCoordsProgress): void` —— 对 `i < min(beat.atomCount, liveAtomCount)`：`positions.writeAtom(i, coords[3i], coords[3i+1], coords[3i+2])`；随后 `positions.refreshBondsAround(0..n-1)` 一次、`tick.flush()` 一次。行 i ↔ logical atom id i（帧段 identity 映射）。
  - 超出 `liveAtomCount` 的行（补氢新增）本轮**忽略**，不在运行中新建实体——运行中新增会改变 `frameOffset` 语义并让每一拍都要重算映射；最终形态由 03 的 `StageOptimizeResultCommand` 一次落地。这一取舍写进 JSDoc。
  - 明令禁止：`applyPipeline`、`registerAtomFrame` / `setFrameData`（会重置 `frameOffset` 并清空编辑池）、任何 `system.frame` 读写。
- `structure.ts`：每次 `runOptimize` 构造一个 `OptimizeLivePaint`，把 `onCoords: (beat) => live.paint(beat)` 传给 `runOptimizeOnWorker`；`onStatus` / `onStep` 现有布线不动（面板进度条继续吃 `onProgress`）。

**核验**：`runLbfgsOptimize`（UFF/MMFF）与 `runDampedOptimize`（soft）两条路径都调 `onStep` 并带 `coords`（收敛提前退出的那一拍也带），因此两条路都必须产出 coords 节拍——这是本条的验证用例，也是「进度条不动」那个报告的真正闭环。

### Reuse decision

| librarian 候选 | 裁决 | 说明 |
|---|---|---|
| `relax.ts` `OptimizeStep.coords`（`:428/:465/:784` 三处已带活缓冲） | **reuse** | 内核不改，只是不再丢弃 |
| `job_runner.ts` `onStep`（"coords stay here"）/ `emitStep` | **generalize** | 同一落点多发一条 coords 节拍；标量节拍保持原样 |
| `protocol.ts` `OptimizeStepProgress` / `OptimizeProgress` | **generalize** | 加第三变体而不是改写既有变体（面板旧布线不破） |
| `protocol.ts` `optimizeJobTransferList` / `optimizeResultTransferList` 命名族 | **pattern（不落地）** | 命名族沿用，但本条**不**新增 `optimizeProgressTransferList`——见下两行 |
| `core/src/workload/worker_side.ts` `reportProgress`（无 transfer 参数）+ 心跳原样重发；`host.ts` 主机侧 | **reuse（不改）** | 心跳重发 detach 缓冲会抛，故拒绝转移语义；core 零改动 |
| `transport/trajectory_worker/protocol.ts` `frameMessageTransferList` + `worker.ts` `postWithTransfer`（绕过信封的流式转移先例） | **pattern（负例，明确不采用）** | 绕过信封就绕过了心跳与取消协议，代价大于每拍 3N f64 的一次拷贝 |
| `compute/worker.ts:76` 拷贝而非转移的既有决定 | **pattern** | 本条沿用同一理由，并在 JSDoc 引用 |
| job_runner 拓扑时序（`:161-236` 补氢/键感知先于 minimize）与「一次性拓扑节拍」建议 | **new — 不做** | 实时只画已有原子，拓扑不需要提前上线；不引入无消费者的 wire 变体 |
| `OptimizeJobResult.atomCount` | **reuse** | 最终原子数仍由 result 给，03 消费 |
| `EditPoolPositions` / `ScenePaintTick`（01） | **reuse** | 实时绘制的唯一写入口与上屏口 |
| `scene_index.ts` `renderIndicesForLogicalId` / `markDirty` 局部上传通道 / `artist.ts:1193` 消费端 / `ImpostorState.buffers` | **reuse** | 与回放同一块缓冲、同一条上传道，差别只在索引映射 |
| `artist.ts` `refreshAtomPositions` | **pattern（负例）** | 稠密帧行键控，编辑池不成立；不复用也不改 |
| `scene_index.ts` `registerAtomFrame` / `setFrameData` / `promoteFrameToEditPool` / `updateMulti` / `markAllDirty` | **pattern（负例）** | 实时路径明令不碰 |
| `StageOptimizeResultCommand`（03） | **reuse** | 最终坐标与新增实体仍由它落地；实时绘制不改变终态 |
| `scene_sync.ts` `materializeFrameFromScene` + `AtomColumnCarrier`（02） | **reuse** | 不受影响（实时只写 meta/缓冲，commit 仍走同一条） |
| dirty 链路 / Ctrl+S / `commitScene` | **reuse** | 实时绘制经 `flush()` 已经把场景标脏，与 03 的终态一致 |
| `manipulate.ts` `emitStatus` → `info-text-change`；`events.ts` `status-message` | **reuse** | 运行中沿用既有瞬时播报，不加新事件 |
| `place_molecule.ts` / `draw.ts` / `composite.ts` / `base.ts` / `commands/index.ts` / `selection.ts` `MoveSelectionCommand` | **defer → 03-command（已定案）** | 本条不新增命令 |
| `structure.ts` `cloneAtomColumns`、`optimize/frame_columns.ts` | **reuse（02 定案）** | 不动 |
| `StructureOptimizePanel.tsx:342` 文案 | **defer → 05-panel** | |
| `stage/tests/impostor_index_maps.test.ts` fake ImpostorState | **pattern** | `live_paint.test.ts` 照此造 fake |

## Files to create or modify

- `stage/src/optimize/protocol.ts`
- `stage/src/optimize/job_runner.ts`
- `stage/src/optimize/worker_client.ts`
- `stage/src/optimize/live_paint.ts` (new)
- `stage/src/optimize/index.ts`
- `stage/src/optimize/structure.ts`
- `stage/tests/optimize/job_runner.test.ts`
- `stage/tests/optimize/worker_client.test.ts`
- `stage/tests/optimize/live_paint.test.ts` (new)
- `regressions/optimize-staging-04-live.ts` (new)

## Tasks

- [ ] Write failing unit tests for the coords beat in stage/tests/optimize/job_runner.test.ts
- [ ] Add OptimizeCoordsProgress to stage/src/optimize/protocol.ts and emit owned-copy beats from stage/src/optimize/job_runner.ts
- [ ] Write failing unit tests for onCoords fan-out in stage/tests/optimize/worker_client.test.ts
- [ ] Implement onCoords in stage/src/optimize/worker_client.ts and export the beat type from stage/src/optimize/index.ts
- [ ] Write failing unit tests for OptimizeLivePaint (stage/tests/optimize/live_paint.test.ts → TestOptimizeLivePaint)
- [ ] Implement OptimizeLivePaint in stage/src/optimize/live_paint.ts
- [ ] Wire OptimizeLivePaint into runOptimize via onCoords in stage/src/optimize/structure.ts
- [ ] Verify coords beats arrive on both kernel paths (LBFGS/UFF and damped/soft) in stage/tests/optimize/job_runner.test.ts
- [ ] Add regression example regressions/optimize-staging-04-live.ts (public API only; hard-coded goldens, no third-party runtime)
- [ ] Run full check + test suite

## Testing strategy

- `stage/tests/optimize/job_runner.test.ts`（扩测，桩掉内核）：`reportEvery = 2`、`maxSteps = 4` → coords 节拍数与 step 节拍数相等；节拍里的 `coords` 与内核缓冲**不是同一个对象**（改内核缓冲后节拍值不变——拷贝语义的硬断言）；LBFGS 路径与 damped 路径各自产出至少一拍 coords（用户报的"界面无显示"闭环）；`atomCount` 等于当前帧原子数。
- `stage/tests/optimize/worker_client.test.ts`（扩测）：`kind: "coords"` 的信封只打到 `onCoords`，`onStep` / `onStatus` 计数为 0；未提供 `onCoords` 时不抛。
- `stage/tests/optimize/live_paint.test.ts`（新，单模块单测，fake `EditPoolPositions` / `ScenePaintTick`）：
  - happy：`liveAtomCount = 2`、`coords = [0.1,0,0, 0.9,0,0]` → 两次 `writeAtom`，参数命中硬编码值。
  - edge：`beat.atomCount = 3 > liveAtomCount = 2` → 只写 2 个，第三行被忽略且不抛。
  - edge：每拍 `refreshBondsAround` 与 `flush` 各恰好一次（不是每原子一次）。
  - edge：`applyPipeline` / `registerAtomFrame` / `setFrameData` 调用次数 0。
  - edge：`beat.coords.length` 与 `atomCount*3` 不符 → 抛描述性 Error（边界校验在 Main 层，不让坏节拍写进 GPU 缓冲）。
- 回归样例：`regressions/optimize-staging-04-live.ts`，导入 `../stage/dist/optimize/live_paint.js`，用纯对象 fake 喂一拍 `coords = [0.1,0,0, 0.9,0,0]`，断言两次写入的字面量与"一拍一次 flush"；再 `readFileSync` `../stage/dist/optimize/job_runner.js` 断言其中出现 `"coords"` 且**不**出现 `optimizeProgressTransferList`（拷贝语义锁）。无 WASM、无外部进程。运行：`npm run build:stage` 后 `node regressions/optimize-staging-04-live.ts`。

## Out of scope

- molrs 版本升级（另开迁移链）。
- 三斜晶胞支持（现有拒绝保持）。
- `MoveSelectionCommand` 删除（走 `/mol:simplify` 或 `/mol:note`）。
- RPC / socket 数据源回写。
- 轨迹多帧优化。
- 优化数值语义：步长、收敛判据、`reportEvery` 默认值一律不改。
- `core/src/workload` 信封改造（widen transfer list）：本条论证为不必要且与心跳重发冲突。
- 运行中新增氢原子的实时显示（终态由 03 落地）。
- 自适应节流 / rAF 合帧：先按 `reportEvery` 原节拍上屏，若实测掉帧再另立条目。
