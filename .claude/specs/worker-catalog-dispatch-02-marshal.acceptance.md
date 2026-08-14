---
slug: worker-catalog-dispatch-02-marshal
criteria:
  - id: ac-001
    summary: dispatch.ts contains no per-id result-shape branch
    type: code
    pass_when: |
      stage/src/analysis/dispatch.ts declares neither normalizeResult nor
      centersOfMassPayload, contains no comparison of definition.id or
      analysisId against a result-shape id, and every molrs result leaves
      runSingleFrame / runFrameRadii / runFrameGroups / runAccumulate through
      marshalAnalysisResult.
    status: verified
    last_checked: 2026-08-14
  - id: ac-002
    summary: Marshalling runs before the producing handles are freed
    type: code
    pass_when: |
      In stage/src/analysis/dispatch.ts every marshalAnalysisResult call sits
      inside the try block that owns the binding, i.e. lexically before the
      finally that calls instance.free() / neighbors.free() / clusters.free().
    status: verified
    last_checked: 2026-08-14
  - id: ac-003
    summary: result_marshal is a readonly literal table with passthrough default
    type: code
    pass_when: |
      stage/src/analysis/result_marshal.ts exports a readonly module-level
      ANALYSIS_RESULT_MARSHALLERS literal keyed by constants imported from
      ./analysis_ids (no bare id strings), plus marshalAnalysisResult; it
      declares no Map, no register function, and an unlisted id returns the raw
      value unchanged.
    status: verified
    last_checked: 2026-08-14
  - id: ac-004
    summary: Kernel layering holds — no new error class, no barrel export
    type: code
    pass_when: |
      AnalysisUnsupportedError is declared once, in
      stage/src/analysis/trajectory_runner.ts, re-exported from dispatch.ts so
      stage/src/index.ts still exports it from ./analysis/dispatch;
      result_marshal.ts imports no Main-layer module (no ../system, no
      ../pipeline, no dispatch) and appears in neither
      stage/src/analysis/index.ts nor stage/src/index.ts.
    status: verified
    last_checked: 2026-08-14
  - id: ac-005
    summary: TestResultMarshal passes alone without loading WASM
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/result_marshal.test.ts"
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/result_marshal.test.ts`
      passes; the file imports no molrs symbol, and covers each of the four
      table entries (field-by-field hard-coded values + free() called exactly
      once), the identity passthrough for an unlisted id, and
      AnalysisUnsupportedError for a malformed raw result.
    status: verified
    last_checked: 2026-08-14
  - id: ac-006
    summary: Existing analysis suites stay green with unchanged payloads
    type: code
    pass_when: |
      stage/tests/analysis/job_runner.test.ts and
      stage/tests/analysis/rdf.test.ts are unmodified by this spec and still
      pass, proving the RDF / MSD payload shapes are byte-identical to the
      pre-spec ones.
    status: verified
    last_checked: 2026-08-14
  - id: ac-007
    summary: Regression script locks the table contract on fake handles
    type: runtime
    pass_when: |
      After `npm run build:stage`, running
      regressions/worker-catalog-dispatch-02-marshal.ts with the repo's TS
      runner prints "worker-catalog-dispatch-02-marshal ok" and exits 0. It
      drives marshalAnalysisResult from ../stage/dist/analysis/result_marshal.js
      with hand-written fake handles and asserts the embedded literal goldens
      binCenters [0.5, 1.5], numPoints 2, rMin 0, volume 8000, that the fake
      handle's free() ran exactly once, and that an unlisted id returns the very
      same object reference. No WASM init, no molrs call, no third-party
      process.
    status: verified
    last_checked: 2026-08-14
  - id: ac-008
    summary: Repo check and full suite stay green
    type: runtime
    pass_when: |
      `biome check . && npm run typecheck` and `npm test` both exit 0 with no
      new failures or skips relative to the pre-spec baseline.
    status: verified
    last_checked: 2026-08-14
---

# Acceptance criteria

- **ac-002** 是本环唯一有真实腐坏风险的一条：把 marshalling 挪到 `finally` 之后能过类型检查、能过大多数测试，却违反 molrs 句柄追踪不变量；因此它是独立的一条，而不是 ac-001 的注脚。
- **ac-006** 用两个**未改动**的既有测试文件充当等价性证人 —— 本环声称"零 payload 变化"，证据必须来自没有被这次改动碰过的断言。
- **ac-005** 特意要求测试文件不 import molrs：`result_marshal.ts` 能被纯假对象驱动，就是它内聚正确、耦合足够低的判据。
