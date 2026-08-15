---
title: commit 路径保全源帧原子列
slug: optimize-staging-02-columns
status: approved
created: 2026-08-15
---

# commit 路径保全源帧原子列

## Summary

`materializeFrameFromScene` 今天只吐 `x/y/z/element` 与 `i/j/bond_type/bond_number`，任何经画布编辑再 commit 的场景都会静默丢掉 charge、mol_id、residue 等列；而 `runOptimize` 靠自己私有的 `cloneAtomColumns` 把列带过 worker 往返。本条把列搬运升成一个结构化协议驱动的共享单元，commit 与 optimize 共用它，既修掉既有的 commit 丢列（这是本链把优化结果改走 commit 之前必须先还的债），也让 `structure.ts` 不再私藏第二份实现。

## Design

新增 `stage/src/atom_columns.ts`：

- `interface ColumnSource` — `keys(): string[]`、`nrows(): number`、`dtype(key): string | undefined`（词表即 molrs 的 dtype 字符串："f32" / "f64" / "i32" / "u32" / "string"——落盘前审计修正：Block 的 dtype 是字符串不是数字，`molrs.d.ts:201`）、`copyColF/copyColStr/copyColU32/copyColI32`。molrs `Block` 结构上满足它（`dtype(key: string): string | undefined`、`keys(): Array<any>` 需收窄）；**声明成结构协议而不是直接吃 `Block`**，单测与回归脚本才能用纯对象驱动，不拉 WASM。
- `interface ColumnSink` — `setColF/setColStr/setColU32/setColI32`。
- `class AtomColumnCarrier`
  - 构造：`(source: ColumnSource)`。
  - `copyInto(dst: ColumnSink, rows: number, sourceRowFor: (row: number) => number | undefined): void` —— 逐列按 dtype 分派；`sourceRowFor` 返回 `undefined` 的目标行取数值 0 / 字符串 `""`（编辑池新增原子没有源行）。`rows` 可大于 `source.nrows()`（补氢后原子数增长）。
  - 调用者负责在其后覆写自己拥有的列（`x/y/z/element`）—— 与今天 `structure.ts` 的顺序一致，不在搬运器里做特例。

接入点：

- `scene_sync.ts materializeFrameFromScene`：当 `options.sourceFrame` 带 atoms block 时，在写完 `x/y/z/element` **之前**跑一次 `copyInto`。行映射由已经在算的 `atomIdToFrameIndex` 反推：`sourceRowFor(denseRow) = 该 dense 行对应的 scene atom id，若该 id 落在源帧行域内（id < sourceAtoms.nrows()）则取 id，否则 undefined`。稀疏（删过原子）与增长（加过原子）两种情况都由这一条规则覆盖，不另开分支。
- `optimize/structure.ts`：删除私有 `cloneAtomColumns`，两处调用（`materializeWorkingFromSource`、`buildResultFrame`）改用 `AtomColumnCarrier`，映射为恒等 `row => row`。第二个调用点到齐，抽取合规。

不变量遵守：搬运器只读源、只写目标，返回前不改源（Immutability）；`Block` 是借用，绝不 `free`（`.claude/notes/notes.md` 2026-08-13 条）。

### Reuse decision

| librarian 候选 | 裁决 | 说明 |
|---|---|---|
| `scene_sync.ts` `materializeFrameFromScene`（⚠ 只吐 x/y/z/element + i/j/bond_type/bond_number） | **generalize** | 本条正是它的推广：接受源帧列并带过 commit |
| `structure.ts` `cloneAtomColumns`（`optimize/frame_columns.ts` 邻居） | **generalize** | 升为 `AtomColumnCarrier`，structure.ts 两处改调用；`optimize/frame_columns.ts` 是 worker 侧 x/y/z 提取器，职责不同，**不合并** |
| `stage/tests/build_frame_from_scene.test.ts` | **reuse** | 按 librarian 建议扩测，不新建镜像文件 |
| `scene_index.ts` `promoteFrameToEditPool` | **pattern（负例）** | commit 路径不调用；列搬运走源帧，不靠提升编辑池 |
| `EditPoolPositions` / `ScenePaintTick`（01 产出） | **reuse** | 本条不调用，但确认唯一写入口已存在，不再造第二个 |
| `scene_index.ts` `renderIndicesForLogicalId` / `markDirty` / `updateAtom` / `updateMulti`；`artist.ts` `refreshAtomPositions`；`manipulate.ts` 四私有 | **defer → 01-positions（已定案）** | 本条不碰缓冲 |
| `scene_index.ts` `createAtom` / `createBond` / `unregisterEditAtom` / `unregisterEditBond` / `getNextAtomId` / `getNextBondId`；`artist.ts` `drawAtom` / `drawBond` / `drawAtomFromBuffers` / `drawBondFromBuffers`；`place_molecule.ts` `PlaceMoleculeCommand`；`draw.ts` `DeleteAtomCommand`；`composite.ts` `CompositeCommand`；`base.ts` `Command`/`@command`；`commands/index.ts` `REGISTERED_COMMAND_CLASSES`；`selection.ts` `MoveSelectionCommand` | **defer → 03-command** | |
| `relax.ts` `OptimizeStep.coords`；`job_runner.ts` `onStep`/`emitStep`；`protocol.ts` `OptimizeStepProgress`/`optimize*TransferList`；`core/src/workload/{worker_side,host}.ts`；`transport/trajectory_worker/protocol.ts`；`compute/worker.ts:76` | **defer → 04-live** | |
| dirty 链路 `markAllUnsaved` → `dirty-change`；Ctrl+S → `commitScene`（`app.ts:531`） | **reuse** | commit 的门与时机不动，只补它写出去的列 |
| `manipulate.ts` `emitStatus`；`events.ts` `status-message`；`StructureOptimizePanel.tsx:342` | **defer → 03-command / 05-panel** | |

## Files to create or modify

- `stage/src/atom_columns.ts` (new)
- `stage/src/scene_sync.ts`
- `stage/src/optimize/structure.ts`
- `stage/tests/atom_columns.test.ts` (new)
- `stage/tests/build_frame_from_scene.test.ts`
- `regressions/optimize-staging-02-columns.ts` (new)

## Tasks

- [ ] Write failing unit tests for AtomColumnCarrier (stage/tests/atom_columns.test.ts → TestAtomColumnCarrier)
- [ ] Implement AtomColumnCarrier in stage/src/atom_columns.ts
- [ ] Write failing unit tests for column-preserving commit in stage/tests/build_frame_from_scene.test.ts
- [ ] Wire materializeFrameFromScene to AtomColumnCarrier in stage/src/scene_sync.ts
- [ ] Replace the private cloneAtomColumns with AtomColumnCarrier in stage/src/optimize/structure.ts
- [ ] Add docstring per jsdoc-tiered covering dtype dispatch and the row-mapping contract in stage/src/atom_columns.ts
- [ ] Add regression example regressions/optimize-staging-02-columns.ts (public API only; hard-coded goldens, no third-party runtime)
- [ ] Run full check + test suite

## Testing strategy

`stage/tests/atom_columns.test.ts` 用纯对象 fake 驱动 `ColumnSource` / `ColumnSink`，不碰 molrs：

- happy：源含 `charge`(F64)、`mol_id`(U32)、`res_name`(String)、`type_id`(I32)，`rows === nrows`，恒等映射 → 四列逐值命中硬编码期望。
- edge：`rows > nrows`（补氢）→ 多出的行数值列为 0、字符串列为 `""`。
- edge：`sourceRowFor` 返回 `undefined` 的行同样取 0 / `""`，且不影响相邻行。
- edge：稀疏映射（源行 0,2,3 → 目标行 0,1,2）不串行。
- edge：未知 dtype 的列被跳过而不抛。
- edge：`copyInto` 之后源对象未被写入（Immutability）。

`stage/tests/build_frame_from_scene.test.ts` 扩测（molrs 真 Block，stage 自己的依赖，仍是单模块单测）：带 `charge` / `mol_id` 的源帧 + 一个编辑池新增原子 → commit 出的 Frame 中原有原子的 `charge` 保值、新增原子为 0；删除一个中间原子后列仍与剩余原子一一对应。

回归样例：`regressions/optimize-staging-02-columns.ts`，导入 `../stage/dist/atom_columns.js`，用字面量列（`charge = [-0.834, 0.417, 0.417]`、`mol_id = [1, 1, 1]`、`res_name = ["HOH","HOH","HOH"]`）跑 `rows = 4` + 恒等映射，断言前三行原值、第四行 `0 / 0 / ""`。无 WASM、无外部工具。运行：`npm run build:stage` 后 `node regressions/optimize-staging-02-columns.ts`。

## Out of scope

- molrs 版本升级（另开迁移链）。
- 三斜晶胞支持（现有拒绝保持）。
- `MoveSelectionCommand` 删除（走 `/mol:simplify` 或 `/mol:note`）。
- RPC / socket 数据源回写。
- 轨迹多帧优化。
- 键列（bond 属性列）的通用搬运：本条只处理原子列，键列仍走既有 `setBondTopology` 四列；需要时另立条目。
- `optimize/frame_columns.ts`（worker 侧）不动。
