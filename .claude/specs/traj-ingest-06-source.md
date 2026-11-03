---
title: DataSource 没有 kind
status: approved
created: 2026-08-18
grilled: true
---

# DataSource 没有 kind

## Summary

`DataSource` 不再带 `kind: "file" | "memory" | "stream"`。不同的 DataSource **子类**各自负责「某种来源 → 内部 `Trajectory` / `Frame`」。分支用 `instanceof FileDataSource` 等，不用字符串枚举。SSH / HTTP 是 **molvis host 的传输**，不是 DataSource 子类，更 **不得**出现在 MolRS。已删除的 `"ssh"` / `"http"` kind 不得复活。

## Domain basis

无。

## Design

今日 `DataSourceKind` 把 acquisition 编成字符串，并写进 project snapshot（`serialize.ts` / `project/types.ts`）和 RPC。这会诱使后人加 `ssh` / `http` kind。用户裁定：kind 不应存在。

- 删 `DataSourceKind` 与 `abstract readonly kind`。
- 行为分支：`instanceof FileDataSource` / `MemoryDataSource` / `StreamDataSource`。
- 序列化：用 **constructor / 稳定 type 名**（已有 `pipelineTypeName` / 类名），不要平行的 kind 字段。hydrate 时按类构造，不 `switch (kind)`。
- `sourceType: "file" | "empty" | "backend"` 是 provenance 文案，不是 kind；能留则留，不拿它当多态。
- 新来源 = 新子类（实现 `getFrame` / `trajectory`），不是枚举加一项。

### Reuse decision

- `reuse` 三个子类本身 — 它们已经是转换器
- `generalize` project payload — 去掉 `kind: DataSourceKind`，改为可 hydrate 的 type 名
- **禁止** 把 ssh/http 做成 DataSource 或写进 molrs

## Files to create or modify

- `stage/src/pipeline/data_source.ts`
- `stage/src/pipeline/index.ts`
- `stage/src/index.ts`
- `stage/src/project/types.ts`
- `stage/src/project/serialize.ts`
- `stage/src/transport/rpc/router.ts`
- `stage/tests/pipeline/data_source.test.ts`
- `page/src/dev/useDevDemo.ts`（若仍读 `primary.kind`）
- `regressions/traj-ingest-06-source.ts` (new)

## Tasks

- [ ] Write failing unit tests that File/Memory/Stream sources have no kind field and instanceof still distinguishes them (stage/tests/pipeline/data_source.test.ts)
- [ ] Remove DataSourceKind and kind from DataSource and subclasses in stage/src/pipeline/data_source.ts; drop the type from pipeline/index.ts and stage/src/index.ts
- [ ] Generalize project serialize/hydrate and RPC to use class/type name instead of kind (stage/src/project/types.ts, serialize.ts, transport/rpc/router.ts); update useDevDemo if it branches on kind
- [ ] Add regression example regressions/traj-ingest-06-source.ts (asserts exported DataSource has no kind; snapshot payload has no DataSourceKind)
- [ ] Run full check + test suite

## Testing strategy

- data_source.test.ts：不再 `expect(ds.kind).toBe("file")`；改为 instanceof。
- serialize：round-trip 不写 `kind: "file"`。
- 静态：`DataSourceKind` 标识符从 stage 公共出口消失；molrs 绑定无此符号。

## Out of scope

- 新的 DataSource 子类（SshDataSource 等）
- 改 MolRS
- 改 ingest 路由 / decideIngest
