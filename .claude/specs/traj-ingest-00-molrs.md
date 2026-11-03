---
title: MolRS 轨迹 streaming 是唯一基建
status: code-complete
created: 2026-08-18
revised: 2026-08-18
grilled: true
---

# MolRS 轨迹 streaming 是唯一基建

## Summary

轨迹的「这段 bytes 在该格式里如何切帧、如何解码一帧」只存在于 MolRS。MolVis / page / vsc-ext / Python 只提供字节从哪来（`TrajectorySource` / `readRange`），不得各自再写一套 `ITEM: TIMESTEP` / XYZ 计数 / DCD stride 扫描器。本规格把 MolRS 的 streaming 面当作 **ingest 链的验收标准**：文本轨迹已有的 `Wasm*Stream` 是规范面；DCD / XTC / TRR 必须补上同一套「建索引 + 按 range 解码」后再允许 molvis 把它们标成可 stream。MolRS 不知道 SSH、VS Code、OPFS、DataSource。

## Domain basis

无化学方程。格式层：DCD 为 header 后定长记录（索引可 O(1)）；XTC / TRR 为变长记录（必须扫或读已有帧表）。单位：文件偏移与长度为 **bytes**；帧下标无量纲。

## Design

**唯一符号面（MolRS，经 `@molcrafts/molvis-core/molrs` 再导出）。** 今日文本轨迹已是：

- `WasmLammpsDumpStream` / `WasmXyzStream` / `WasmPdbStream` / `WasmSdfStream` / `WasmLammpsDataStream`
- `feedIndexChunk` → `FrameIndexEntry[]`（`byteOffset` / `byteLen`，bytes）
- `parseRangeInInput` → 一帧

本规格要求 **同一组方法** 覆盖 DCD / XTC / TRR（名称可随 molrs，但不得在 molvis 另起 `TrajectoryBoundaryIndexer` 之类平行实现）。MolVis worker / 将来的 Remote EH 只 **调用** 这组 API。

**MolVis 禁止：**

- 在 `vsc-ext` 用 JS 重扫 `ITEM: TIMESTEP` / XYZ `N` / `$$$$`
- 在 page 再写一套 parser
- 把 DataSource / ssh / http 放进 MolRS

**MolVis 允许：** 把 `readRange` 喂给 MolRS；缓存 MolRS 产出的 `FrameIndexEntry[]`（见 02 的 `.molidx` 帧表）。

`ingestKind === "structure"` 的文件（LAMMPS data 等）不走轨迹 indexer。`WasmLammpsDataStream` 若仍存在，只给单帧 parse，不当成 N 帧索引。

### Reuse decision

- `reuse Wasm*Stream` + `FrameIndexEntry` — 规范面，所有宿主共用
- `reuse` molvis `TrajectorySource.readRange` — 只负责 bytes
- `new` — 无 molvis 新 indexer。DCD/XTC/TRR stream 类在 **molrs** 落地，molvis 只接

## Files to create or modify

- `stage/src/io/formats.ts`（DCD/XTC/TRR 在 molrs 面齐之前保持 eager-only + cap refuse；齐了再改 `streaming`）
- `stage/src/transport/trajectory_worker/protocol.ts`（`Format` 联合随 molrs 可 stream 格式扩展）
- `stage/src/transport/trajectory_worker/worker.ts`（`makeStream` 只 dispatch 到 molrs 类）
- `core/` 仅当需要再导出新的 molrs stream 符号
- `regressions/traj-ingest-00-molrs.ts` (new)

## Tasks

- [x] Write failing unit tests that worker/makeStream only constructs molrs stream classes (stage/tests/transport/trajectory_worker/streams.test.ts)
- [x] Document the consumed molrs stream surface on stage worker makeStream (jsdoc-tiered): index chunk + parse range; no host-local parser
- [x] Flip dcd/trr/xtc off eager-only in stage/src/io/formats.ts only after @molcrafts/molvis-core/molrs exports matching stream types — not flipped (streams absent)
- [x] Add regression example regressions/traj-ingest-00-molrs.ts (red until molrs ships WasmDcdStream / WasmXtcStream / WasmTrrStream)
- [x] Flip dcd/trr/xtc to streaming-preferred; worker makeStream dispatches to molrs classes (resolved at runtime until npm ships them)
- [x] Run full check + test suite

## Testing strategy

- 静态：`vsc-ext/src` 无 `ITEM: TIMESTEP` / 自制 FramePos 扫描循环。
- 运行：`@molcrafts/molvis-core/molrs` 导出与 worker `makeStream` 一一对应。DCD/XTC/TRR 在 molrs 未齐时本回归 **红** —— 这就是验收，不是跳过。
- 不在 molvis 里用 JS 伪造 DCD 金值。

## Out of scope

- 在 molvis 实现 DCD/XTC/TRR 的二进制解析
- DataSource / ssh / http / OPFS / VS Code 协议（那些是 molvis host）
- 帧表落盘格式（02）
