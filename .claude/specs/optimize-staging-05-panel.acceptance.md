---
slug: optimize-staging-05-panel
criteria:
  - id: ac-001
    summary: Staged completion line matches the hard-coded golden string
    type: runtime
    pass_when: |
      page/tests/lib/optimize-staging-copy.test.ts asserts optimizeStagedLine({ steps: 37,
      maxForce: 0.041, converged: true, cancelled: false, hydrogensAdded: 0 }) ===
      "Optimized in 37 steps · max |F| 0.041 — Ctrl+S to save".
    status: verified
    last_checked: 2026-08-15
  - id: ac-002
    summary: Every completion branch ends with the save hint
    type: runtime
    pass_when: |
      The max-steps and cancelled branches end with OPTIMIZE_SAVE_HINT; the
      converged branch FOLDS the hint's leading verb ("Optimized" does double
      duty — see ac-001's golden, which does not contain the hint as a
      substring) and ends with the tail "— Ctrl+S to save"; the
      hydrogensAdded 4 case contains "+4 H" (on every branch — hydrogens
      added before a cancelled run are staged too). Pre-implementation
      audit: the original "all branches endsWith(HINT)" wording was
      mathematically incompatible with ac-001's golden.
    status: verified
    last_checked: 2026-08-15
  - id: ac-003
    summary: The pre-run gate copy no longer says "Save scene before optimizing"
    type: runtime
    pass_when: |
      page/tests/ui/layout/StructureOptimizePanel.test.tsx renders the UnsavedSceneError branch and
      finds OPTIMIZE_DIRTY_GATE_HINT while queryByText("Save scene before optimizing") is null.
    status: verified
    last_checked: 2026-08-15
  - id: ac-004
    summary: A finished run shows the staged line in the panel
    type: runtime
    pass_when: |
      With runOptimize stubbed to resolve, the panel renders the exact string returned by
      optimizeStagedLine for that outcome.
    status: verified
    last_checked: 2026-08-15
  - id: ac-005
    summary: The progress bar is proven to move on both potentials
    type: runtime
    pass_when: |
      page/tests/ui/layout/StructureOptimizePanel.test.tsx drives step beats for potential "uff"
      and for "soft" and asserts the rendered progress value goes 0 -> 50 -> >=98 in each case
      (the running-state mapping caps at 98 via Math.min(98, ...); 100 is reserved for
      completion — asserting 100 from step beats would be a false-red against the shipped cap).
    status: verified
    last_checked: 2026-08-15
  - id: ac-006
    summary: Copy module stays free of React and stage runtime imports
    type: code
    pass_when: |
      page/src/lib/optimize-staging-copy.ts has no react import and no value import from
      @molcrafts/molvis-stage (type-only imports allowed); `npm run typecheck:page` passes.
    status: verified
    last_checked: 2026-08-15
  - id: ac-007
    summary: Regression script locks the copy on both sides of the boundary
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-05-panel.ts` exits 0 and prints
      "optimize-staging-05-panel ok"; it asserts the literal "Optimized — Ctrl+S to save" appears in
      both page/src/lib/optimize-staging-copy.ts and stage/dist/optimize/structure.js, and that
      "Save scene before optimizing" appears in neither — no subprocess, no third-party tool.
    status: verified
    last_checked: 2026-08-15
  - id: ac-008
    summary: Copy module documents the two save meanings
    type: docs
    pass_when: |
      page/src/lib/optimize-staging-copy.ts documents that OPTIMIZE_DIRTY_GATE_HINT is the
      pre-run gate for the user's own canvas edits while OPTIMIZE_SAVE_HINT is the post-run staged
      result hint, and that the latter is duplicated verbatim by the stage-side info-text line.
    status: pending
---

# Acceptance criteria

- **ac-001/002** 把三分支文案收成纯函数并锁 golden 全串。
- **ac-003/004** 是语义反转的两端：门文案换新、完成文案带保存提示。
- **ac-005** 进度条真动的证明——按运行态封顶 98 断言（落盘前审计修正：原稿的 100 对着 `Math.min(98, …)` 必假红）。
- **ac-007** 跨边界字面量对齐锁（page 源 + stage 构建产物）。
