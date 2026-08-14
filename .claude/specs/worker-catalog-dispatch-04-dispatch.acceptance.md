---
slug: worker-catalog-dispatch-04-dispatch
criteria:
  - id: ac-001
    summary: The worker no longer enumerates analysis ids to decide what it can run
    type: code
    pass_when: |
      stage/src/analysis/job_runner.ts contains neither the string
      "not available on the worker" nor readRdfParams / readMsdParams; its only
      id-keyed structure is TRAJECTORY_ENTRY_RUNNERS with exactly two entries
      (rdf, msd) sourced from ./analysis_ids, and every other id falls through
      to catalog inputKind dispatch.
    status: verified
    last_checked: 2026-08-14
  - id: ac-002
    summary: rdf and msd keep their trajectory entry-layer semantics on the worker
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/job_runner.test.ts"
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/job_runner.test.ts`
      passes with its pre-existing rdf / msd / triclinic / cancel cases
      unmodified, proving both ids still route to computeRdfTrajectory /
      computeMsdTrajectory (group selections, frame averaging, reference frame)
      rather than to raw shape dispatch.
    status: verified
    last_checked: 2026-08-14
  - id: ac-003
    summary: shape_dispatch.ts is kernel-safe and unexported
    type: code
    pass_when: |
      stage/src/analysis/shape_dispatch.ts imports no Main-layer module (no
      ../system, no ../pipeline, no ../artist, no ./dispatch, no Babylon) and
      appears in neither stage/src/analysis/index.ts nor stage/src/index.ts;
      stage/src/analysis/dispatch.ts declares none of runSingleFrame, coerce,
      ctorArgs, instantiate, CatalogAccumulator or PER_FRAME_KINDS and imports
      them from shape_dispatch instead.
    status: verified
    last_checked: 2026-08-14
  - id: ac-004
    summary: Public API surface is unchanged except the two new wire symbols
    type: code
    pass_when: |
      stage/src/index.ts still exports AnalysisParamValues (re-exported from
      dispatch.ts, declaration now in shape_dispatch.ts), and the only added
      public symbols are snapshotCoversAnalysis and AnalysisShapeResult; no
      export is removed or renamed.
    status: verified
    last_checked: 2026-08-14
  - id: ac-005
    summary: Snapshot coverage is one declaration used by both the worker and its callers
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/worker_protocol.test.ts"
    pass_when: |
      snapshotCoversAnalysis is declared once, in
      stage/src/analysis/worker_protocol.ts, is called by job_runner.ts as its
      admission gate, and its unit test covers the six documented verdicts
      (empty requires per-frame true, accumulate true, series false,
      frameGroupSets false, velocity false, atomPairs false, voidMask true)
      without importing molrs.
    status: verified
    last_checked: 2026-08-14
  - id: ac-006
    summary: Rejections use AnalysisUnsupportedError and name the blocking reason
    type: code
    pass_when: |
      An unknown id, an uncovered requirement and an unsupported inputKind all
      raise AnalysisUnsupportedError from the worker with the analysisId set
      and the blocking requirement or inputKind named in the message; no new
      error class is declared anywhere in this spec.
    status: verified
    last_checked: 2026-08-14
  - id: ac-007
    summary: Worker failures cross the wire as plain data
    type: code
    pass_when: |
      AnalysisShapeResult.failures is typed Array<{ frameIndex: number;
      message: string }>, the worker never puts an Error instance on the wire,
      and the main-thread AnalysisRunResult (with real Error objects and
      trackedSelection) is left unchanged.
    status: verified
    last_checked: 2026-08-14
  - id: ac-008
    summary: Regression script locks the coverage verdicts and the seam shape
    type: runtime
    pass_when: |
      After `npm run build:stage`, running
      regressions/worker-catalog-dispatch-04-dispatch.ts with the repo's TS
      runner prints "worker-catalog-dispatch-04-dispatch ok" and exits 0,
      asserting the six hard-coded snapshotCoversAnalysis verdicts through
      ../stage/dist/index.js and, by reading stage/src/analysis/job_runner.ts
      as text, that readRdfParams / readMsdParams and the
      "not available on the worker" message are gone and that
      TRAJECTORY_ENTRY_RUNNERS has exactly two entries. No WASM init, no
      worker spawn, no third-party process.
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

- **ac-002** 用**未改动**的既有 worker 测试来判 rdf / msd 语义未被形状分发悄悄接管 —— 这是本环最贵的一次误判（RdfPanel 的图表会静默换成另一种数据），必须由不属于本次改动的断言来证。
- **ac-005** 把"快照携带什么"钉成一处声明：worker 与面板（06 环）共用同一个谓词，两边不可能漂移出"面板允许提交、worker 拒收"的组合。
- **ac-007** 是跨线程最容易被忽略的一条：`Error` 能被结构化克隆但会掉原型，把它当 wire 类型迟早出现"failures 里的 AnalysisAbortError 变成普通 Error"的怪账。
