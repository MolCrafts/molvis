---
slug: worker-catalog-dispatch-01-seams
criteria:
  - id: ac-001
    summary: Only trajectory_runner declares AnalysisRunOptions
    type: code
    pass_when: |
      A repo search for "interface AnalysisRunOptions" under stage/src returns
      exactly one hit, stage/src/analysis/trajectory_runner.ts; dispatch.ts
      declares AnalysisDispatchOptions and uses it at all four former call
      sites; stage/src/index.ts still exports AnalysisRunOptions sourced from
      ./analysis/trajectory_runner.
    status: verified
    last_checked: 2026-08-14
  - id: ac-002
    summary: analysis_ids.ts is an import-free constant module
    type: code
    pass_when: |
      stage/src/analysis/analysis_ids.ts exists, contains no import statement
      at all, and exports the nine *_ANALYSIS_ID constants for
      rdf.radial_distribution, msd.mean_squared_displacement,
      cluster.connected_components, shape.center_of_mass,
      shape.cluster_properties, spectroscopy.power_spectrum and the three
      voronoi.* ids.
    status: verified
    last_checked: 2026-08-14
  - id: ac-003
    summary: No stage/src file outside analysis_ids.ts spells a catalog id
    type: code
    pass_when: |
      A repo search for the regex "(rdf|msd|cluster|shape|voronoi|spectroscopy)\.[a-z_]+"
      inside string literals under stage/src returns hits only in
      stage/src/analysis/analysis_ids.ts; dispatch.ts, job_runner.ts and
      cluster_pipeline.ts reference the imported constants instead.
    status: verified
    last_checked: 2026-08-14
  - id: ac-004
    summary: Public API surface is unchanged except the new id constants
    type: code
    pass_when: |
      stage/src/index.ts still exports COM_ANALYSIS_ID, RG_ANALYSIS_ID,
      isComAnalysisId and isRgAnalysisId from ./pipeline/cluster_pipeline, and
      the diff of exported symbol names before/after this spec adds only the
      analysis id constants — no removal, no rename.
    status: verified
    last_checked: 2026-08-14
  - id: ac-005
    summary: analysis barrel exists and never exposes a worker kernel
    type: code
    pass_when: |
      stage/src/analysis/index.ts exists with a Wire/Main/Kernel table
      mirroring stage/src/optimize/index.ts:1-13; it re-exports no symbol from
      job_runner.ts, rdf.ts, msd.ts or trajectory_analyses.ts; and no file
      under stage/src/analysis/{job_runner,rdf,msd,trajectory_analyses}.ts nor
      stage/src/compute/worker.ts imports "./index" / "../analysis".
    status: verified
    last_checked: 2026-08-14
  - id: ac-006
    summary: TestAnalysisIds passes alone and pins ids to the molrs catalog
    type: code
    evaluator_hint: "test_single: stage/tests/analysis/analysis_ids.test.ts"
    pass_when: |
      `npm run build:core && npm run test -w @molcrafts/molvis-stage -- tests/analysis/analysis_ids.test.ts`
      passes on its own, with cases covering hard-coded literal equality, the
      nine ids being distinct, and getAnalysisDefinition(id) being defined for
      every one of them.
    status: verified
    last_checked: 2026-08-14
  - id: ac-007
    summary: Regression script locks the public id + barrel surface
    type: runtime
    pass_when: |
      After `npm run build:stage`, running regressions/worker-catalog-dispatch-01-seams.ts
      with the repo's TS runner prints "worker-catalog-dispatch-01-seams ok"
      and exits 0. It imports only ../stage/dist/index.js and asserts the
      embedded literal goldens RDF_ANALYSIS_ID === "rdf.radial_distribution",
      MSD_ANALYSIS_ID === "msd.mean_squared_displacement",
      COM_ANALYSIS_ID === "shape.center_of_mass" (source comment: molrs compute
      catalog 0.13.1, @molcrafts/molrs ^0.13.1, 2026-08-14), that runAnalysis /
      expandFrameRange / snapshotFrameForAnalysis are functions, and that
      "runAnalysisJob" is absent from the namespace import. No molrs runtime
      call, no WASM init.
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

- **ac-001 / ac-004** 一起构成"本环零行为变化"的证明：内部类型改名 + 常量搬家都不得改动公共导出集合（新增常量除外）。
- **ac-003** 是可执行的收敛判据：任何一处遗漏的裸 id 字面量都会被该 grep 抓到，避免"只统一了一半"。
- **ac-005** 是本链条最容易被后续环打破的一条（04 环加 `shape_dispatch.ts` 时尤甚），所以它现在就成为硬门。
- **ac-006** 中 `getAnalysisDefinition(id)` 用例若失败，属于发现既有死分支，走 no-silent-debt：修掉或 hard-stop 上报，不得删常量或改断言。
