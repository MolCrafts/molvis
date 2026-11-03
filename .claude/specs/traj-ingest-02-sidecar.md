---
title: 帧索引表 .molidx v2
status: code-complete
created: 2026-08-18
revised: 2026-08-18
grilled: true
---

# 帧索引表 .molidx v2

## Summary

`.molidx` **不是**又一种轨迹格式，也不是 MolRS 的一部分。它只是 MolRS 已经算出来的 `FrameIndexEntry[]`（每帧 `byteOffset` + `byteLen`，单位 bytes）的落盘缓存，避免第二次打开同一文件时再扫一遍。口语里的 sidecar = 挨着源文件（或 OPFS 里）放的这份小表。完整表 → 跳过扫描；不完整表 → 从最后一条完整帧的末尾续扫，**不得**把 `indexedFrames` 当成终长。表由 **MolRS indexer 产出**，molvis 只负责编解码与放置。本规格只做 stage OPFS 这一档；文件旁 / workspace 放置是 05。

未知 `molidxVersion` → `null` → 重扫。v1 仍能解码。不把源文件拷进 `OpfsBlobCache`。

## Domain basis

无。

## Design

本规格只改 `@molcrafts/molvis-stage` 的 sidecar 编解码与 worker 落盘策略。`traj-ingest-01-index` 提供 `length` / `indexedLength` / `indexComplete` 与增量事件；本规格消费那份契约（不完整恢复不得发终态 `index-ready`），但不实现那些 Trajectory 字段。

**Sidecar 一词**：companion file，即「源轨迹旁边（或缓存里）的小文件」。内容只有帧表，没有坐标。索引算法仍是 00 的 MolRS stream。

继续以 `stage/src/io/cache/molidx_codec.ts` 的 `CachedIndex` + `encodeMolidx` / `decodeMolidx` 为唯一编解码面。`encodeMolidx` 只写 v2；`decodeMolidx` 读 v1 或 v2，其它 version / 坏 magic / 截断 / 未知 `formatId` 返回 `null`。增加纯函数 `decideMolidxUse`（`miss | hit | resume`）。`OpfsIndexCache` 仍是 `/molvis/v1/idx/<safeKey(fingerprint)>.molidx` 的唯一读写器。不改 `core/src/opfs.ts`。

v2 `CachedIndex`：`format`, `fileSize`, `identity`（mtime / head+tail hash / legacy）, `molidxVersion`, `indexerVersion`（stage 常量 `STAGE_INDEXER_VERSION = 1`）, `scannedBytes`, `indexedFrames`, `complete`, `entries: FramePos[]`。

`decideMolidxUse`：`complete === false` **永不**返回 `hit`。`resume` 的 `scannedBytes` 取最后一条完整 `FramePos` 的 `byteOffset + byteLen`。`handleOpen`：hit → 灌表 + `index-ready`；resume → 灌表后从 `scannedBytes` 继续扫，结束前不得 `index-ready`；miss → 从 0 扫。检查点按现有 `PROGRESS_THROTTLE_MS` 写 `complete=false`。禁止 `OpfsBlobCache.set`。

### Reuse decision

- `reuse OpfsIndexCache` / `fingerprintFile` / `OpfsBucket idx`
- `generalize molidx_codec VERSION` — 双读（v1 promote + v2）单写 v2
- 不采用：`decideIngest`、page、vsc-ext、`HostRangeSource`

## Files to create or modify

- `stage/src/io/cache/molidx_codec.ts`
- `stage/src/io/cache/index.ts`
- `stage/src/io/cache/opfs_index_cache.ts`
- `stage/src/transport/trajectory_worker/worker.ts`
- `stage/tests/io/cache/molidx_codec.test.ts`
- `stage/tests/io/cache/opfs_index_cache.test.ts`
- `regressions/traj-ingest-02-sidecar.ts` (new)

## Tasks

- [x] Write failing unit tests for v2 encodeMolidx / decodeMolidx / decideMolidxUse (stage/tests/io/cache/molidx_codec.test.ts)
- [x] Generalize encodeMolidx / decodeMolidx / CachedIndex in stage/src/io/cache/molidx_codec.ts to molidx v2 and re-export from stage/src/io/cache/index.ts
- [x] Write failing unit tests for OpfsIndexCache v2 round-trip and v1 buffer get (stage/tests/io/cache/opfs_index_cache.test.ts)
- [x] Update OpfsIndexCache in stage/src/io/cache/opfs_index_cache.ts to persist v2 CachedIndex
- [x] Implement handleOpen hit / resume / checkpoint persist in stage/src/transport/trajectory_worker/worker.ts via decideMolidxUse (no OpfsBlobCache.set)
- [x] Add JSDoc per jsdoc-tiered (Full on encodeMolidx / decodeMolidx / decideMolidxUse) with units (bytes, ms)
- [x] Add regression example regressions/traj-ingest-02-sidecar.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Verify against v1 promote, unknown-version miss, and incomplete resume-not-final
- [ ] Run full check + test suite

## Testing strategy

- Codec：v2 往返；手写 v1 DataView promote；version 99 / 坏 magic → null；incomplete → resume 不是 hit；`scannedBytes >= fileSize` 的 incomplete → miss。
- OpfsIndexCache：v2 set/get；读入手写 v1 得 promote。
- 回归：`stage/dist/io/cache/molidx_codec.js`；xyz/4096/两帧 encode version word = 2；改 99 → null；incomplete → resume scannedBytes 2048。

## Out of scope

- 修改 `core/`
- `OpfsBlobCache` 自动拷贝源文件
- 文件旁 / workspace cache（05）
- page、`decideIngest`、`HostRangeSource`
- 实现 Trajectory 三分量（01）
- OPFS 路径改成 `/molvis/v2/`
- 向 molrs 索取 indexer version
