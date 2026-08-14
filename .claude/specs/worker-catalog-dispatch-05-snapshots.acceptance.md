---
slug: worker-catalog-dispatch-05-snapshots
criteria:
  - id: ac-001
    summary: Range packer exists next to the single-frame packer and is public
    type: code
    pass_when: |
      snapshotFramesForAnalysis is declared in
      stage/src/analysis/worker_protocol.ts adjacent to
      snapshotFrameForAnalysis, takes (AnalysisTrajectorySource, FrameRange?)
      and is exported from both stage/src/analysis/index.ts and
      stage/src/index.ts.
    status: pending
  - id: ac-002
    summary: It reuses the single-frame packer and the shared range expansion
    type: code
    pass_when: |
      The implementation calls expandFrameRange and snapshotFrameForAnalysis
      and contains no column reading, no cell reading and no dtype check of its
      own; stage/src/analysis/worker_protocol.ts still has exactly one place
      that copies frame columns.
    status: pending
  - id: ac-003
    summary: Frames are never freed and snapshots are independent copies
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/worker_protocol.test.ts"
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/worker_protocol.test.ts`
      passes with cases proving the source frames are still readable after the
      call (no free) and that mutating a returned snapshot array does not touch
      the source column.
    status: pending
  - id: ac-004
    summary: Empty and inverted ranges answer with an empty array
    type: code
    pass_when: |
      snapshotFramesForAnalysis returns [] for a zero-length source and for
      start > endInclusive, throws nothing, and emits no console output; the
      "not enough frames" product copy stays in the calling panels.
    status: pending
  - id: ac-005
    summary: Source frame indices survive striding
    type: code
    pass_when: |
      For a four-frame source with stride 2 the returned snapshots carry
      frameIndex 0 and 2 (the caller's own numbering), not 0 and 1.
    status: pending
  - id: ac-006
    summary: Regression script locks the packer through the public barrel
    type: runtime
    pass_when: |
      After `npm run build:stage`, running
      regressions/worker-catalog-dispatch-05-snapshots.ts with the repo's TS
      runner prints "worker-catalog-dispatch-05-snapshots ok" and exits 0,
      driving snapshotFramesForAnalysis from ../stage/dist/index.js with a
      hand-written frame source and asserting the hard-coded goldens: two
      snapshots, frameIndex [0, 2], x contents equal to the source, and no free
      call on any source frame. No WASM init, no molrs call, no third-party
      process.
    status: pending
  - id: ac-007
    summary: Repo check and full suite stay green
    type: runtime
    pass_when: |
      `biome check . && npm run typecheck` and `npm test` both exit 0 with no
      new failures or skips relative to the pre-spec baseline.
    status: pending
---

# Acceptance criteria

- **ac-003** 是本环唯一有真实腐坏风险的一条：范围版一旦"顺手"释放它取过的帧，破坏的是轨迹的共享句柄，症状会出现在毫不相干的渲染路径上。
- **ac-005** 守住源帧编号透传：进度拍与 `framesVisited` 全靠它对齐；把 0…n−1 的作业内序号写进快照是一个安静但致命的错误。
- **ac-004** 明确"空范围不是错误"：产品文案留在面板，避免同一句话在 stage 和 page 各有一份。
