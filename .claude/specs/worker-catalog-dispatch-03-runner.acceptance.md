---
slug: worker-catalog-dispatch-03-runner
criteria:
  - id: ac-001
    summary: Only one per-frame loop remains under stage/src/analysis
    type: code
    pass_when: |
      The only loop over frame indices under stage/src/analysis is the one in
      runTrajectoryFrames (stage/src/analysis/trajectory_runner.ts);
      trajectory_analyses.ts has no frame loop left (its only for statements
      are the per-bin loops inside averageRdfResults) and dispatch.ts's only
      remaining frame loop is inside stackVectorColumns, carrying the comment
      that explains why it stays.
    status: verified
    last_checked: 2026-08-14
  - id: ac-002
    summary: The frame runner accepts any AnalysisTrajectorySource
    type: code
    pass_when: |
      TrajectoryFrameRunOptions.trajectory is typed AnalysisTrajectorySource,
      stage/src/analysis/trajectory_runner.ts no longer imports Trajectory, and
      its only runtime (non type-only) imports are ../utils/dtype and
      ../utils/yield_ui.
    status: verified
    last_checked: 2026-08-14
  - id: ac-003
    summary: missingTrackedAtoms "throw" actually aborts the run
    type: code
    pass_when: |
      In runTrajectoryFrames the missing-tracked-atoms decision is taken
      outside the per-frame try, so "throw" rejects the returned promise while
      the default "skip-frame" still records a failure and continues; both
      modes have a case in stage/tests/analysis/trajectory_runner.test.ts.
    status: verified
    last_checked: 2026-08-14
  - id: ac-004
    summary: Accumulate runner builds on the frame runner and never frees its sink
    type: code
    pass_when: |
      runTrajectoryAccumulate delegates its iteration to runTrajectoryFrames
      (no loop of its own), passes undefined as atomIndices when the tracked
      selection mode is "all", calls no dispose/free method on the sink, and is
      exported from neither stage/src/index.ts nor
      stage/src/analysis/index.ts.
    status: verified
    last_checked: 2026-08-14
  - id: ac-005
    summary: Progress and cancel contract is byte-identical for the worker
    type: runtime
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/job_runner.test.ts`
      passes unmodified: one progress beat per planned frame including failed
      frames, beats emitted from the finally, framesVisited unchanged, and a
      cancelled job still resolving with cancelled: true via AnalysisAbortError.
    status: verified
    last_checked: 2026-08-14
  - id: ac-006
    summary: MsdAnalyzer is the single MSD driver and honours the selection
    type: code
    pass_when: |
      stage/src/analysis/dispatch.ts builds MSD accumulation with MsdAnalyzer
      and yields analyzer.result().frames as the payload (same
      Array<{mean, perParticle}> shape as before); no raw MSD binding is
      instantiated anywhere in dispatch.ts; the accumulate path passes the
      resolved atom indices to the sink; and stage/src/analysis/result_marshal.ts
      no longer carries an msd entry (its case removed from
      stage/tests/analysis/result_marshal.test.ts too).
    status: verified
    last_checked: 2026-08-14
  - id: ac-007
    summary: Entry-layer tests pin RDF averaging and MSD series to hard values
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/trajectory_analyses.test.ts"
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/trajectory_analyses.test.ts`
      passes, covering hard-coded per-bin averages for gr / summed counts over
      two frames, group A + group B subset tracking, one bad frame recorded in
      failures while the run continues, the all-frames-failed rethrow, MSD means
      for a translated three-frame fixture, the <2 frames null, and
      AnalysisAbortError on cancel.
    status: verified
    last_checked: 2026-08-14
  - id: ac-008
    summary: Regression script drives both runners from a fake frame source
    type: runtime
    pass_when: |
      After `npm run build:stage`, running
      regressions/worker-catalog-dispatch-03-runner.ts with the repo's TS runner
      prints "worker-catalog-dispatch-03-runner ok" and exits 0. Importing
      ../stage/dist/analysis/trajectory_runner.js, it drives runTrajectoryFrames
      and runTrajectoryAccumulate with a hand-written trajectory source and
      asserts the embedded literal goldens: visit order [0, 2] for stride 2 over
      4 frames, exactly 1 recorded failure when a visit throws, 4 sink feeds for
      the unstrided run, and error.name === "AnalysisAbortError" on an aborted
      run. No WASM init, no molrs call, no third-party process.
    status: verified
    last_checked: 2026-08-14
  - id: ac-009
    summary: Repo check and full suite stay green
    type: runtime
    pass_when: |
      `biome check . && npm run typecheck` and `npm test` both exit 0 with no
      new failures or skips relative to the pre-spec baseline.
    status: verified
    last_checked: 2026-08-14
---

# Acceptance criteria

- **ac-005** 是本环风险最高的一条，因此故意用**未改动**的 `job_runner.test.ts` 来判：进度拍语义（每帧一拍、失败帧也算、发在 finally）是 worker 把 job 内序号映射回源帧号并轮询取消的唯一依据，收敛循环时最容易被无声改掉。
- **ac-001 / ac-004** 一起把"不许出现第四个循环"变成结构性的、可 grep 的判据，而不是评审时的口头约定。
- **ac-003** 是本环按 no-silent-debt 顺手修掉的既有缺陷：`missingTrackedAtoms: "throw"` 的文档承诺此前从未兑现；它有独立验收项，不并进放宽那一条。
- **ac-006** 同时守住两件事：MSD 只剩一个驱动，且 payload 形状对既有公共调用方零变化（`runAnalysis` 是公共 API，`GenericAnalysisPanel.tsx:180` 是树内唯一调用方）。
