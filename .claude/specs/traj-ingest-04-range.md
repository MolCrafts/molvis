---
title: 轨迹摄入 04：VS Code 按范围读取
status: approved
created: 2026-08-18
grilled: true
---

# 轨迹摄入 04：VS Code 按范围读取

## Summary

在 VS Code 里打开可流式轨迹时，扩展宿主不再把整份文件 `readFile` 再 `postMessage` 进 webview；宿主只发送 `openUri`，webview 按需 `readRange`，宿主用 Node 定位 `fs.read` 回 `bytes`，并可用 `cancelRange` 丢掉未完成的切片。`decideIngest(..., { hostCanRange: true })` 之后，超过 512 MiB 的可流式轨迹走 stream 而不再因整文件上限被拒绝；结构文件仍不建索引。Quick View 与 Stage 共用同一套新消息。

## Domain basis

无。

## Design

依赖 01 的 `HostRangeSource`（`kind: "host"`）与 `loadFileStream(app, Blob | TrajectorySource, …)`。本规格只改 `vsc-ext`。

协议（不删 `loadFile`）：

| 方向 | type | 字段 |
|---|---|---|
| Host→webview | `openUri` | uri, filename, format, size（bytes）, mtime（ms）, mode? |
| Webview→host | `readRange` | uri, start, end, fetchId（`[start,end)` bytes） |
| Host→webview | `bytes` | fetchId, data |
| Webview→host | `cancelRange` | fetchId |

`QUICK_VIEW_HOST_MESSAGE_TYPES` 增加 `openUri` / `bytes`。

`MolecularLoadIntent`：`decideIngest(format, size, { hostCanRange: true })`。stream → `open-uri`（**不得** `readFile`）；结构 / 小轨迹 → `read-bytes`；eager-only 轨迹 ≥ 512 MiB → refuse。仅 `file:` 做 positional read。

`FileRangeReader`：`fs.promises.open` + 定位 `read`。`WebviewHostRangeSource` 实现 01 的 host source，经 `postMessage` 拉切片。`attachStageHost` 的 `openUri` 调用 `loadFileStream(app, source, …)`，禁止再把整文件 `Uint8Array` 包 `Blob`。

### Reuse decision

- `reuse decideIngest` / `loadFileStream`
- `generalize loadFile` 消息、`MolecularFileLoader.load`、`attachStageHost`
- `reuse sendLoadedFile`（加 `openUri` 分支）
- 不建 molidx write-beside / EH indexer（05）

## Files to create or modify

- `vsc-ext/src/protocol/messages.ts`
- `vsc-ext/src/extension/loading/molecularLoadIntent.ts` (new)
- `vsc-ext/src/extension/loading/fileRangeReader.ts` (new)
- `vsc-ext/src/extension/loading/molecularFileLoader.ts`
- `vsc-ext/src/extension/panels/messaging.ts`
- `vsc-ext/src/extension/panels/previewPanel.ts`
- `vsc-ext/src/extension/panels/stagePanel.ts`
- `vsc-ext/src/extension/panels/binaryEditorProvider.ts`
- `vsc-ext/src/extension/panels/editorProvider.ts`
- `vsc-ext/src/webview/hostRangeSource.ts` (new)
- `vsc-ext/src/webview/attachStageHost.ts`
- `vsc-ext/tests/unit/protocol/messages.test.ts`
- `vsc-ext/tests/unit/loading/molecularLoadIntent.test.ts` (new)
- `vsc-ext/tests/unit/loading/fileRangeReader.test.ts` (new)
- `vsc-ext/tests/unit/webview/hostRangeSource.test.ts` (new)
- `vsc-ext/tsconfig.test.json`
- `docs/interfaces/vscode/remote.md`
- `docs/interfaces/vscode/troubleshooting.md`
- `regressions/traj-ingest-04-range.ts` (new)

## Tasks

- [ ] Write failing unit tests for Quick View host messages and MolecularLoadIntent
- [ ] Write failing unit tests for FileRangeReader and WebviewHostRangeSource
- [ ] Generalize messages.ts with openUri / bytes / readRange / cancelRange
- [ ] Implement FileRangeReader, MolecularLoadIntent; generalize MolecularFileLoader and sendLoadedFile so stream trajectories post openUri and never readFile
- [ ] Implement WebviewHostRangeSource; generalize attachStageHost; wire readRange/cancelRange on Stage panels
- [ ] Add JSDoc per jsdoc-tiered (bytes, half-open range, mtime ms); update tsconfig.test.json includes; rewrite 512 MiB refuse paragraphs in remote.md and troubleshooting.md
- [ ] Add regression example regressions/traj-ingest-04-range.ts
- [ ] Run full check + test suite

## Testing strategy

- Intent：dump 16 MiB / 512 MiB → open-uri；`.data` 2 GiB → read-bytes；dcd 512 MiB → refuse。
- FileRangeReader：文件 `abcdefghij` 的 `[2,6)` = `cdef`；cancel 后 reject。
- WebviewHostRangeSource：`kind === "host"`；fetchId 多路；迟到 bytes no-op。
- 回归：`decideIngest("lammps-dump", 536870912, { hostCanRange: true }) === { path: "stream" }`；loader 文本含 `hostCanRange: true` 且不含 `false`。

## Out of scope

- Remote indexer / molidx write-beside（05）
- 新 DataSourceKind
- 改 stage/（01）
- page hostCanRange
- Sketch range
- 非 file: scheme
- DCD/TRR/XTC ≥ 512 MiB
