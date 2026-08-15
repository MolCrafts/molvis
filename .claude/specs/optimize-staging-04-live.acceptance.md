---
slug: optimize-staging-04-live
criteria:
  - id: ac-001
    summary: Every reported minimizer step also emits a coords beat
    type: runtime
    pass_when: |
      tests/optimize/job_runner.test.ts with reportEvery 2 and maxSteps 4 records an equal count of
      kind "step" and kind "coords" beats, each coords beat carrying step/maxSteps and
      atomCount matching the frame.
    status: verified
    last_checked: 2026-08-15
  - id: ac-002
    summary: Coords beats carry an owned copy, never the kernel's live buffer
    type: runtime
    pass_when: |
      Mutating the kernel coordinate buffer after a beat was emitted leaves the captured beat's
      coords unchanged, and the beat's buffer is not the same object identity as the kernel buffer.
    status: verified
    last_checked: 2026-08-15
  - id: ac-003
    summary: Both kernel paths report coordinates
    type: runtime
    pass_when: |
      tests/optimize/job_runner.test.ts asserts at least one kind "coords" beat for a molrs
      potential run (LBFGS) and at least one for a soft/damped run.
    status: verified
    last_checked: 2026-08-15
  - id: ac-004
    summary: Coords beats fan out only to onCoords
    type: runtime
    pass_when: |
      tests/optimize/worker_client.test.ts feeds { kind: "optimize", progress: { kind: "coords", … } }
      and records 1 onCoords call, 0 onStep and 0 onStatus calls; omitting onCoords does not throw.
    status: verified
    last_checked: 2026-08-15
  - id: ac-005
    summary: Live paint writes one atom per coordinate triple
    type: runtime
    pass_when: |
      tests/optimize/live_paint.test.ts asserts paint() on coords [0.1,0,0, 0.9,0,0] issues
      writeAtom(0, 0.1, 0, 0) and writeAtom(1, 0.9, 0, 0), then exactly one refreshBondsAround and
      one flush.
    status: verified
    last_checked: 2026-08-15
  - id: ac-006
    summary: Rows beyond the live atom count are ignored, not created
    type: runtime
    pass_when: |
      A beat with atomCount 3 against liveAtomCount 2 produces exactly 2 writeAtom calls, no atom
      creation call, and no throw.
    status: verified
    last_checked: 2026-08-15
  - id: ac-007
    summary: Live paint never rebuilds the scene or resets the edit pool
    type: runtime
    pass_when: |
      Spies record 0 calls to applyPipeline, registerAtomFrame and setFrameData across a 10-beat
      paint sequence.
    status: verified
    last_checked: 2026-08-15
  - id: ac-008
    summary: A malformed beat is rejected at the main-thread boundary
    type: runtime
    pass_when: |
      paint() on a beat whose coords.length !== atomCount * 3 throws a descriptive Error and issues
      zero writeAtom calls.
    status: verified
    last_checked: 2026-08-15
  - id: ac-009
    summary: The workload envelope is untouched
    type: code
    pass_when: |
      This spec's diff lists no file under core/src/workload/, and
      stage/src/optimize/protocol.ts declares no optimizeProgressTransferList.
    status: verified
    last_checked: 2026-08-15
  - id: ac-010
    summary: Regression script reproduces the live-paint goldens and the copy lock
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-04-live.ts` exits 0 and prints
      "optimize-staging-04-live ok"; it asserts the literal writes (0, 0.1, 0, 0) and (1, 0.9, 0, 0),
      one flush per beat, and that stage/dist/optimize/job_runner.js contains "coords" but not
      "optimizeProgressTransferList" — no subprocess, no third-party tool.
    status: verified
    last_checked: 2026-08-15
  - id: ac-011
    summary: Copy-not-transfer decision is documented where it binds
    type: docs
    pass_when: |
      stage/src/optimize/protocol.ts documents that coords beats are structured-cloned because
      workload reportProgress has no transfer parameter and its heartbeat re-posts the last
      progress verbatim, citing core/src/workload/worker_side.ts and stage/src/compute/worker.ts.
    status: pending
---

# Acceptance criteria

- **ac-001..003** 锁「坐标不再被丢弃」且两条内核路径都产拍——这正是用户报告的闭环。
- **ac-002** 的对象身份断言是拷贝语义的硬门（心跳重发 detach 缓冲会抛的那个坑）。
- **ac-005..008** 锁实时绘制的边界：只画已有原子、一拍一刷、坏节拍在边界拒绝、绝不重建场景。
- **ac-009** 锁「core 零改动」的架构决策。
- **ac-011** 把拷贝-而非-转移的理由写在它约束的地方。
