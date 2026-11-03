---
title: 文件轨迹三分量索引（先首帧）
status: in-progress
created: 2026-08-18
grilled: true
---

# 文件轨迹三分量索引（先首帧）

## Summary

打开一份**大小固定**的流式轨迹文件时，Stage 不再等整条索扫描完才露面：worker 一旦闭合第 0 个 `FramePos`，主线程即可 `loadFrame(0)` 并 `installPrimaryTrajectory`，索引在同一条 `TrajectoryRuntime` 后台继续。`Trajectory` 把「已知终长 / 已索引帧数 / 是否扫完」拆成三个显式字段，播放与 seek 只在已索引窗口内活动；分析或导出若声称「整条轨迹」，必须等索引完成，或由调用方给出显式帧范围。`FileDataSource.frameCount` 用 `length ?? indexedLength` 作展示用计数，但在 `indexComplete === false` 时不得把该数字说成完整 N。活 socket 的 `StreamDataSource` 仍走自己的保留窗口，不把文件扫描伪装成「文件在涨」。

## Domain basis

无。`$META.science.required` 为 false；本规格是 ingest / 索引编排，不是物理模型。

## Design

本规格只动 `@molcrafts/molvis-stage`。切帧/解码 **只调用 00 的 MolRS stream**，不在 stage 再写格式扫描器。文件字节数在打开时已确定（`TrajectorySource.size()`），扫描只是发现帧边界，不是追加字节。

### `Trajectory` 三分量

推广现有单一 `_length: number`，而不是再挂一个平行计数器当「真 length」。

| 字段 | 类型 | 含义 |
|---|---|---|
| `length` | `number \| null` | **已知终长**。完整 sidecar / 将来 header 给出 N 时为该 N；扫描中未知则为 `null`。**禁止**随 `feedIndexChunk` 把 `length` 往上加（那是「文件在涨」语义）。 |
| `indexedLength` | `number` | 已有 `FramePos`、因而可 `loadFrame` / seek 的帧数。扫描中单调不减。 |
| `indexComplete` | `boolean` | 索引扫描是否结束。 |

方法（都挂在 `Trajectory` 上，单职责，不用工厂、不用 context bag）：

- `recordIndexedLength(indexedLength: number, knownLength?: number \| null): void` — 扫描推进。只更新 `indexedLength`；仅当传入 `knownLength` 时才写 `length`。`indexedLength` 不得回退。
- `markIndexComplete(): void` — 扫描结束。`indexComplete = true`，`length = length ?? indexedLength`。若此前已有 `knownLength` 且与 `indexedLength` 不一致，抛错。
- `requireCompleteLength(purpose: string): number` — 「整条轨迹」消费者的门闩。`indexComplete === false` 或 `length === null` 时抛错，信息里带 `purpose`。

导航：`seek` / `next` / `prev` / `frame` / `hasCachedFrame` / `prefetch` 一律钳到 `[0, indexedLength)`。已知终长大于已索引窗口时，**不得**把播放头钳到尚未有 `FramePos` 的下标。

构造约定：

- eager `new Trajectory(frames)`、`fromProvider`、`addFrame` / `dropOldestFrame`：始终 `indexComplete === true` 且 `length === indexedLength`。`addFrame` 同时增加二者——这是 `StreamDataSource` 的保留窗口，**只用于活流 / 内存轨迹**。
- `fromAsyncProvider(provider)`：若 provider 仍带数值 `length`，视为**已完成**快照。若未带 `length`，则 `length = null`、`indexedLength = 0`、`indexComplete = false`，由 `loadFileStream` 用 `recordIndexedLength` / `markIndexComplete` 往前推。
- `AsyncFrameProvider` 不再把 `length: number` 当作播放上界；`get(index)` 只负责取帧。`FrameProvider`（同步懒加载）保持 `length: number`，视为完整。
- `isLazy` 同时覆盖同步 provider 与 `_asyncProvider`，避免 `System.setTrajectory` 在扫描中走 `aggregateFrameLabels`。

`StreamDataSource` **不**改成文件扫描模型：继续 `push` → `addFrame` / `dropOldestFrame`。禁止用 `recordIndexedLength` 喂活 socket。

### Worker / Runtime：先首帧，不新开 worker

推广现有 `IndexProgress` / `IndexReady` 与 `TrajectoryRuntime.open`。

`IndexProgress` 增加可选 `knownLength?: number | null`。**第 0 个 `FramePos` 从 0 变为 ≥1 时必须立刻 `sendIndexProgress`，不受现有 50 ms 节流。** `IndexReady` 仍表示扫描结束。

`OpenResult`：

```ts
interface OpenResult {
  indexedLength: number;
  length: number | null;
  indexComplete: boolean;
  totalBytes: number;
}
```

`TrajectoryRuntime.open`：第一条 `framesIndexedSoFar >= 1` 的 `IndexProgress`（或没有任何 progress 的 `IndexReady`）即 resolve。不得等到扫描结束。后续 `IndexProgress` 走 `onProgress`；`IndexReady` 走 `OpenOptions.onIndexComplete` 与 `whenIndexComplete`。`cancelOpen`：若 `open()` 仍 pending 则拒绝之；若已先首帧 resolve，则只取消剩余扫描，**不** `markIndexComplete`。

Worker 对同一 `Format` 构造两个现有 `Wasm*Stream`（`indexStream` / `parseStream`）。证明格式仅限 xyz / lammps-dump / pdb / sdf。

现有 `OpfsIndexCache.get` 快路径保持「直接 `IndexReady`、`indexComplete: true`」。codec 写入留给 02。

### `loadFileStream` 与 `FileDataSource`

复用 `decideIngest` / `BlobRangeSource` / `loadFileStream` / `DataSourceKind`。`replace`：先 `fromAsyncProvider`（无数值 `length`），`await runtime.open` 后 `recordIndexedLength` + `installPrimaryTrajectory`。**不要**等 `whenIndexComplete`。发：

- `length-changed`: `{ indexedLength, length, indexComplete }`
- `index-complete`: `{ indexedLength, length }`

`augment` / `extend` 在组 DS 之前 `await runtime.whenIndexComplete`。

`FileDataSource.frameCount` = `trajectory.length ?? trajectory.indexedLength`。`indexComplete === false` 时不得把 `frameCount` 说成完整 N。

`System._navigateTo` / 胶片条 / RPC `nFrames` 读 `indexedLength`。`aggregateFrameLabels` 用 `requireCompleteLength("frame-labels")`。分析走 `resolveVisitLength`：无显式范围要求 complete；显式范围钳到 `indexedLength`。

### Host-range `TrajectorySource`（给 04 的缝）

`TrajectorySource.kind` 增加 `"host"`。新增 `HostRangeSource`：构造注入 `{ size(): Promise<number>; readRange(start: number, end: number): Promise<Uint8Array> }`，实现 `TrajectorySource`。`loadFileStream` 第二参改为 `Blob | TrajectorySource`：`Blob` 仍包 `BlobRangeSource`；已是 source 则直接用。Worker `SourceHandle` 增加 `{ kind: "host"; totalBytes }`，字节仍走现有 `request-bytes`（主线程调 `HostRangeSource.readRange`）。本规格不实现 VS Code 协议。

### Reuse decision

- `reuse decideIngest` / `ingestKind` / `TrajectorySource` / `BlobRangeSource` / `loadFileStream` / `DataSourceKind` / `Wasm*Stream`
- `generalize Trajectory.length` / `TrajectoryRuntime.open` / `IndexProgress`+`IndexReady` / `TrajectorySource.kind`（加 `"host"`）
- `pattern StreamDataSource` — 只保留 `addFrame` 窗口，不当文件轨迹
- `new HostRangeSource` — 04 需要可注入的 range 实现；不重写 `BlobRangeSource`

## Files to create or modify

- `stage/src/system/trajectory.ts`
- `stage/src/transport/trajectory_worker/protocol.ts`
- `stage/src/transport/trajectory_worker/runtime.ts`
- `stage/src/transport/trajectory_worker/worker.ts`
- `stage/src/io/index.ts`
- `stage/src/io/sources/trajectory_source.ts`
- `stage/src/io/sources/host_range_source.ts` (new)
- `stage/src/io/sources/index.ts`
- `stage/src/pipeline/data_source.ts`
- `stage/src/pipeline/stream_data_source.ts`
- `stage/src/events.ts`
- `stage/src/system.ts`
- `stage/src/system/source_composition.ts`
- `stage/src/system/frame_labels.ts`
- `stage/src/analysis/trajectory_runner.ts`
- `stage/src/analysis/trajectory_analyses.ts`
- `stage/src/analysis/dispatch.ts`
- `stage/src/analysis/worker_protocol.ts`
- `stage/src/ui/manager.ts`
- `stage/src/transport/rpc/router.ts`
- `stage/tests/system/trajectory.test.ts`
- `stage/tests/transport/trajectory_worker/runtime.test.ts`
- `stage/tests/pipeline/data_source.test.ts`
- `stage/tests/analysis/trajectory_runner.test.ts`
- `stage/tests/io/sources/host_range_source.test.ts` (new)
- `regressions/traj-ingest-01-index.ts` (new)

## Tasks

- [x] Write failing unit tests for Trajectory three-component state (stage/tests/system/trajectory.test.ts)
- [x] Generalize Trajectory.length in stage/src/system/trajectory.ts (indexedLength, indexComplete, recordIndexedLength, markIndexComplete, requireCompleteLength; jsdoc-tiered Full)
- [x] Write failing unit tests for TrajectoryRuntime.open first-frame resolve and HostRangeSource (stage/tests/transport/trajectory_worker/runtime.test.ts, stage/tests/io/sources/host_range_source.test.ts)
- [x] Generalize IndexProgress/IndexReady, TrajectoryRuntime.open, dual Wasm*Stream, HostRangeSource, and loadFileStream(Blob | TrajectorySource)
- [x] Write failing unit tests for FileDataSource.frameCount and resolveVisitLength (stage/tests/pipeline/data_source.test.ts, stage/tests/analysis/trajectory_runner.test.ts)
- [x] Wire FileDataSource, StreamDataSource window reads, System navigation, MolvisEventMap length-changed/index-complete, source_composition, frame_labels, analysis, ui/manager, rpc nFrames
- [x] Add regression example regressions/traj-ingest-01-index.ts (public API only; hard-coded goldens, no third-party runtime)
- [x] Verify against first-frame-first file ingest (open resolves at indexedLength >= 1, playback clamps, whole-trajectory analysis throws until complete)
- [ ] Run full check + test suite

## Testing strategy

单测只放 `stage/tests/`，镜像 `src/`。单元绿 = `npm run test -w @molcrafts/molvis-stage -- <该文件>`。

- Trajectory：eager 三帧 complete；`fromAsyncProvider` 无 length 时 `length === null`；`recordIndexedLength(1)` 不改 `length`；`seek` 钳到 `indexedLength`；`requireCompleteLength` 在 complete 前抛错。
- Runtime：FakeWorker 先 `IndexProgress{framesIndexedSoFar:1}` 再 `IndexReady{frameCount:7}` → `open()` 在 Ready 前 resolve。
- HostRangeSource：注入 fake `readRange`，`kind === "host"`，`readRange(2,6)` 原样转发。
- FileDataSource / `resolveVisitLength`：扫描中 `frameCount === indexedLength` 且非 complete；无范围 + incomplete 抛错；显式范围可用。
- 回归：空 eager `(0,0,true)`；扫描 `recordIndexedLength(1)` → `(null,1,false)`；`markIndexComplete()` → `length === 1`。无 WASM / 无 worker。

## Out of scope

- sidecar 读写（02）
- VS Code `openUri` / `readRange` 协议（04）
- page HUD（03）
- Phase 0 `decideIngest` 重做
- MolRS DCD / XTC / TRR
- 把 `StreamDataSource` 当文件扫描
- 新 Dedicated Worker / `FormatIndexer`
- 解析 header N（只预留 `knownLength`）
