---
slug: worker-catalog-dispatch-06-panels
criteria:
  - id: ac-001
    summary: Route selection is one pure function with exhaustive unit coverage
    type: code
    evaluator_hint: "test_single: page/tests/ui/layout/analysis/analysisRunPlan.test.ts"
    pass_when: |
      `npm run build:stage && npm run build:engines && npm run test -w page -- tests/ui/layout/analysis/analysisRunPlan.test.ts`
      passes, covering pipeline for COM / Rg, worker for empty-requires
      per-frame and accumulate analyses (rdf and msd included), and main for
      series, velocity-requiring and frameGroupSets definitions; the test file
      imports no React, no worker and no WASM.
    status: verified
    last_checked: 2026-08-14
  - id: ac-002
    summary: The panel routes through the plan and never re-derives coverage
    type: code
    pass_when: |
      page/src/ui/layout/analysis/GenericAnalysisPanel.tsx calls
      planAnalysisRun and branches only on its route; the page tree contains no
      second implementation of the snapshot-coverage rule (no inputKind or
      requires inspection outside analysisRunPlan.ts).
    status: verified
    last_checked: 2026-08-14
  - id: ac-003
    summary: Worker submissions reuse the shared packing and selection helpers
    type: code
    pass_when: |
      GenericAnalysisPanel's worker branch builds its job with
      snapshotFramesForAnalysis and wireAtomSelection and submits through
      runAnalysisOnWorker; RdfPanel.tsx and MsdPanel.tsx no longer call
      expandFrameRange and no longer contain a per-frame snapshot loop.
    status: verified
    last_checked: 2026-08-14
  - id: ac-004
    summary: runAnalysis is retained, not treated as dead code
    type: code
    pass_when: |
      stage/src/index.ts still exports runAnalysis, and
      GenericAnalysisPanel.tsx still calls it on the "main" route with a
      comment naming it as the path for analyses the snapshot cannot carry;
      neither the export nor the call site is deleted.
    status: verified
    last_checked: 2026-08-14
  - id: ac-005
    summary: COM / Rg keep the pipeline short-circuit with its reason recorded
    type: code
    pass_when: |
      The COM / Rg branch in GenericAnalysisPanel.tsx is unchanged in behaviour
      (ensure*Modifier → applyPipeline → readClusterMask →
      computeClusterMaskProperties) and carries a comment naming the Canvas
      WYSIWYG = SceneIndex invariant as the reason it does not go to the worker.
    status: verified
    last_checked: 2026-08-14
  - id: ac-006
    summary: Only dispatch-identity literals are converged
    type: code
    pass_when: |
      RdfPanel.tsx, MsdPanel.tsx and LeftSidebar.tsx contain no
      "rdf.radial_distribution" / "msd.mean_squared_displacement" literal and
      use the stage id constants instead, while useAnalysisCatalog.ts and
      molpy-docs.ts keep their literal record keys, each carrying the one-line
      comment that says the choice is deliberate.
    status: verified
    last_checked: 2026-08-14
  - id: ac-007
    summary: Panel empty states and result plumbing are unchanged
    type: code
    evaluator_hint: "test_single: page/tests/ui/layout/analysis/GenericAnalysisPanel.test.tsx"
    pass_when: |
      `npm run build:stage && npm run build:engines && npm run test -w page -- tests/ui/layout/analysis/GenericAnalysisPanel.test.tsx`
      passes with the pre-existing title-only empty-state case unmodified plus
      the new "No series yet" case, and the panel's RunState still carries
      payload / perFrame / frameIndices / failures with the same meanings.
    status: verified
    last_checked: 2026-08-14
  - id: ac-008
    summary: Regression script locks the panel wiring by source text
    type: runtime
    pass_when: |
      After `npm run build:stage`, running
      regressions/worker-catalog-dispatch-06-panels.ts with the repo's TS runner
      prints "worker-catalog-dispatch-06-panels ok" and exits 0, asserting from
      page source text that GenericAnalysisPanel references
      runAnalysisOnWorker / snapshotFramesForAnalysis / planAnalysisRun and
      still references runAnalysis and isComAnalysisId, that RdfPanel and
      MsdPanel dropped expandFrameRange and the two id literals, that
      LeftSidebar dropped them too, that useAnalysisCatalog and molpy-docs kept
      their literal keys, and that the stage id constants from
      ../stage/dist/index.js equal their hard-coded golden strings. No WASM
      init, no worker spawn, no third-party process.
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

- **ac-004** 存在的唯一目的就是防止实现阶段把 `runAnalysis` 当死代码清掉：它在本环之后仍有一个真实调用方（`main` 路由），并且本身是公共 API；删除它属于路由策略 + 公共面变更，两者都在本链范围外。
- **ac-002** 守住"覆盖规则只有一处声明"：page 一旦自己判 `inputKind` / `requires`，就会和 worker 的准入闸漂移出"面板允许提交、worker 拒收"的组合。
- **ac-006** 把跨链锁定的半统一决策变成可验收项：三处分发身份必须收敛、两张展示查表必须保留字面量，两个方向都写死，不允许下一个人凭印象改。
- **ac-001 / ac-007** 的分工是本环的测试形态：路由由纯函数穷举，面板只测不触发 worker 的可见状态 —— page 无法注入假 compute 宿主，而为一次断言引入 e2e 通道是本仓库明令禁止的。
