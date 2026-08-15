---
title: 编辑池位置写入与一次性上屏抽取
slug: optimize-staging-01-positions
status: code-complete
created: 2026-08-15
---

# 编辑池位置写入与一次性上屏抽取

## Summary

拖拽路径里那套「按 logical id 解析 render index → 只改 matrix 平移与 instanceData 前三位 → 局部 markDirty → 重建关联键 → 一次上屏」的配方，今天是 `ManipulateMode` 的四个私有方法，既没有第二个入口，也无法单独单测（要 Babylon 指针模式才能跑到）。本条把它原样抽成 stage 层两个小类，拖拽成为第一个调用者，行为、缓冲写法、脏标记时机全部不变；产出的是后续「优化结果入编辑池」与「优化过程实时绘制」唯一合法的位置写入口。

## Design

新增模块 `stage/src/edit_pool_positions.ts`，两个高内聚类，构造参数全部是窄协议（不接受 `MolvisApp`），因此单测可用 fake 全覆盖：

- `EditPoolPositions`
  - 构造：`(sceneIndex: SceneIndex, bondStyles: BondRadiusSource)`。
  - `writeAtom(atomId: number, x: number, y: number, z: number): void` — 经 `ImpostorState.renderIndicesForLogicalId(atomId)` 取 render index（**强制**：原子增删后 `idToIndex` 不再是恒等映射），写 `matrix[idx*stride + 12..14]` 与 `instanceData[idx*stride + 0..2]`（Å），**保留** `matrix[0/5/10]` 缩放与 `instanceData[3]` 半径，然后 `markDirty("matrix", "instanceData")`，最后 `sceneIndex.updateAtom(meshId, atomId, { position })` **不传 bufferUpdates**（传了会走 `updateMulti` 的 `markAllDirty`，重传颜色缓冲并抹掉选中高亮）。不上屏、不动键。
  - `refreshBondsAround(atomIds: Iterable<number>): void` — 先按 `topology.incident` 汇成 Set，保证「两端都动了的键」只重建一次；必须在本 tick 所有原子写入之后调用（端点位置从 meta 读）。
  - `refreshBond(bondId: number): void` — 从两端 meta 重建 sub-bond 缓冲（`bondPlaneAxis` + `buildSubBondInstanceBuffers`），经 `updateBond` 落回。
  - `BondRadiusSource = { getBondStyle(sticks: number): { radius: number } }` — 只要半径，不要整个 `StyleManager`。
- `ScenePaintTick`
  - 构造：`(painter: SceneMeshPainter, sceneIndex: SceneIndex, highlighter: HighlightInvalidator)`；
    `SceneMeshPainter = { applySceneIndexToMeshes(): void }`，`HighlightInvalidator = { invalidateAndRebuild(): void }`。
  - `flush(): void` — 依次 `painter.applySceneIndexToMeshes()` → `sceneIndex.markAllUnsaved()` → `highlighter.invalidateAndRebuild()`。顺序是语义的一部分：键重建会脏化颜色缓冲，高亮必须在上屏之后重建，否则一次拖拽看起来像取消选择。

生命周期与所有权：两个类都不持有 `app`，由调用者在 attach 时构造一次并持有（不要每帧新建 —— 与 gizmo 的 bind-on-attach 同一教训）。`ManipulateMode` 删除 `writeAtomPosition` / `refreshBondsAround` / `refreshBond` / `flushVisuals` 四个私有方法，改为委派。

抽取理由（对照 design-preferences「用到第二次再抽」）：触发条件是**单测**那一条 —— 这段配方今天无法脱离 Babylon 指针模式验证；抽出后它是本链后续三条的唯一写入口。

### Reuse decision

| librarian 候选 | 裁决 | 说明 |
|---|---|---|
| `manipulate.ts` `writeAtomPosition` | **generalize** | 升为 `EditPoolPositions.writeAtom`，manipulate 成为第一个调用者 |
| `manipulate.ts` `refreshBondsAround` / `refreshBond` | **generalize** | 同上，成为 `EditPoolPositions` 的方法，一 tick 一次的语义保留 |
| `manipulate.ts` `flushVisuals` | **generalize** | 升为 `ScenePaintTick.flush`，三步顺序原样 |
| `scene_index.ts` `renderIndicesForLogicalId` | **reuse** | 唯一合法 id→render index 通道，不另造 |
| `scene_index.ts` `markDirty` 局部上传通道（`artist.ts:1193` 消费端） | **reuse** | 只标 `matrix`/`instanceData` |
| `scene_index.ts` `updateAtom`（meta-only） | **reuse** | 不传 buffer maps |
| `scene_index.ts` `updateMulti` / `markAllDirty` | **pattern（负例）** | 明令不走：会重传颜色并抹掉高亮 |
| `artist.ts` `refreshAtomPositions` | **new** | 它按稠密帧行键控，编辑池 id 稀疏后不成立；`writeAtom` 是它的 id 映射兄弟，不复用也不改它（回放路径继续用） |
| `stage/tests/impostor_index_maps.test.ts` 的 fake ImpostorState | **pattern** | 本条单测照抄这套 fake 构造法 |
| `scene_index.ts` `createAtom` / `createBond` / `unregisterEditAtom` / `unregisterEditBond` / `getNextAtomId` / `getNextBondId`；`artist.ts` `drawAtom` / `drawBond` / `drawAtomFromBuffers` / `drawBondFromBuffers` | **defer → 03-command** | 本条只写位置，不增删实体 |
| `scene_sync.ts` `materializeFrameFromScene`；`structure.ts` `cloneAtomColumns`；`optimize/frame_columns.ts` | **defer → 02-columns** | |
| `place_molecule.ts` `PlaceMoleculeCommand`；`draw.ts` `DeleteAtomCommand`；`composite.ts` `CompositeCommand`；`base.ts` `Command`/`@command`；`commands/index.ts` `REGISTERED_COMMAND_CLASSES`；`selection.ts` `MoveSelectionCommand` | **defer → 03-command** | |
| `relax.ts` `OptimizeStep.coords`；`job_runner.ts` `onStep` / `emitStep`；`protocol.ts` `OptimizeStepProgress` / `optimize*TransferList`；`core/src/workload/{worker_side,host}.ts`；`transport/trajectory_worker/protocol.ts` `frameMessageTransferList`；`compute/worker.ts:76` | **defer → 04-live** | |
| `scene_index.ts` `promoteFrameToEditPool` / `registerAtomFrame` / `setFrameData` | **pattern（负例）** | 本模块永不调用：`setFrameData` 会重置 `frameOffset` 并清空编辑池 |
| dirty 链路 `markAllUnsaved` → `onDirtyChange` → `dirty-change`；Ctrl+S `mode/base.ts` / `ViewerToolbar` → `commitScene` | **reuse** | 原样，不改 |
| `manipulate.ts` `emitStatus` → `info-text-change`；`events.ts` `status-message` | **defer → 03-command / 05-panel** | |
| `StructureOptimizePanel.tsx:342` 文案 | **defer → 05-panel** | |

## Files to create or modify

- `stage/src/edit_pool_positions.ts` (new)
- `stage/src/mode/manipulate.ts`
- `stage/tests/edit_pool_positions.test.ts` (new)
- `regressions/optimize-staging-01-positions.ts` (new)

## Tasks

- [x] Write failing unit tests for EditPoolPositions (stage/tests/edit_pool_positions.test.ts → TestEditPoolPositions)
- [x] Implement EditPoolPositions in stage/src/edit_pool_positions.ts
- [x] Write failing unit tests for ScenePaintTick (stage/tests/edit_pool_positions.test.ts → TestScenePaintTick)
- [x] Implement ScenePaintTick in stage/src/edit_pool_positions.ts
- [x] Rewire ManipulateMode to EditPoolPositions + ScenePaintTick and delete its four private writers in stage/src/mode/manipulate.ts
- [x] Add docstring per jsdoc-tiered with Å units to stage/src/edit_pool_positions.ts
- [x] Add regression example regressions/optimize-staging-01-positions.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Run full check + test suite

## Testing strategy

单测只在 `stage/tests/edit_pool_positions.test.ts`，单模块、单函数，依赖全部用 fake（fake `ImpostorState` 照 `stage/tests/impostor_index_maps.test.ts` 的构造法，fake `SceneIndex` 只实现 `meshRegistry.getAtomState/getBondState`、`updateAtom`、`updateBond`、`topology`、`markAllUnsaved`）。绿灯口径是 `npm run test -w @molcrafts/molvis-stage -- tests/edit_pool_positions.test.ts`，不是全量套件。

- happy：帧段原子（identity 映射）写 (1.5, −2.25, 0.5) → `matrix[id*16+12..14]` 与 `instanceData[id*4+0..2]` 命中硬编码值。
- happy：编辑池原子（`idToIndex` + `frameOffset`）解析到正确绝对行。
- edge：未知 id → 不写、不抛。
- edge：`markDirty` 恰好收到 `("matrix","instanceData")`，`markAllDirty` 调用次数为 0。
- edge：`updateAtom` 收到的第四参为 `undefined`（不带 buffer maps）。
- edge：缩放位 `matrix[0/5/10]` 与半径位 `instanceData[3]` 写前写后不变。
- edge：一条键的两端都移动 → `refreshBond` 恰好调用一次。
- happy：`ScenePaintTick.flush()` 三个协作者各调用一次，且顺序为 painter → markAllUnsaved → highlighter。

回归样例：`regressions/optimize-staging-01-positions.ts`，导入 `../stage/dist/edit_pool_positions.js`（构建产物深路径，与 `regressions/worker-catalog-dispatch-03-runner.ts` 同惯例），用纯对象 fake 驱动，断言上述硬编码坐标与脏缓冲名集合；无 molrs、无 WASM、无外部进程。运行方式：`npm run build:stage` 后 `node regressions/optimize-staging-01-positions.ts`。

## Out of scope

- molrs 版本升级（另开迁移链）。
- 三斜晶胞支持：`runOptimize` 现有拒绝原样保留。
- `MoveSelectionCommand` 删除：零调用点的负例，走 `/mol:simplify` 或 `/mol:note`，不在本链顺手删。
- RPC / socket 数据源回写。
- 轨迹多帧优化。
- 批量 set-positions API：本条只搬现有逐原子写法，不引入新的批量语义（真需要时由 04 的实测节奏决定）。
