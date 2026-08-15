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
    status: pending
  - id: ac-002
    summary: Every completion branch ends with the save hint
    type: runtime
    pass_when: |
      The converged, max-steps and cancelled branches all end with OPTIMIZE_SAVE_HINT, and the
      hydrogensAdded 4 case contains "+4 H".
    status: pending
  - id: ac-003
    summary: The pre-run gate copy no longer says "Save scene before optimizing"
    type: runtime
    pass_when: |
      page/tests/ui/layout/StructureOptimizePanel.test.tsx renders the UnsavedSceneError branch and
      finds OPTIMIZE_DIRTY_GATE_HINT while queryByText("Save scene before optimizing") is null.
    status: pending
  - id: ac-004
    summary: A finished run shows the staged line in the panel
    type: runtime
    pass_when: |
      With runOptimize stubbed to resolve, the panel renders the exact string returned by
      optimizeStagedLine for that outcome.
    status: pending
  - id: ac-005
    summary: The progress bar is proven to move on both potentials
    type: runtime
    pass_when: |
      page/tests/ui/layout/StructureOptimizePanel.test.tsx drives step beats for potential "uff"
      and for "soft" and asserts the rendered progress value goes 0 -> 50 -> >=98 in each case
      (the running-state mapping caps at 98 via Math.min(98, ...); 100 is reserved for
      completion — asserting 100 from step beats would be a false-red against the shipped cap).
    status: pending
  - id: ac-006
    summary: Copy module stays free of React and stage runtime imports
    type: code
    pass_when: |
      page/src/lib/optimize-staging-copy.ts has no react import and no value import from
      @molcrafts/molvis-stage (type-only imports allowed); `npm run typecheck:page` passes.
    status: pending
  - id: ac-007
    summary: Regression script locks the copy on both sides of the boundary
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-05-panel.ts` exits 0 and prints
      "optimize-staging-05-panel ok"; it asserts the literal "Optimized — Ctrl+S to save" appears in
      both page/src/lib/optimize-staging-copy.ts and stage/dist/optimize/structure.js, and that
      "Save scene before optimizing" appears in neither — no subprocess, no third-party tool.
    status: pending
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
