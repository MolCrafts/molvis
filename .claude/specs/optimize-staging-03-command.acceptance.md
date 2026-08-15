---
slug: optimize-staging-03-command
criteria:
  - id: ac-001
    summary: Staged result writes optimized coordinates into the edit pool
    type: runtime
    pass_when: |
      tests/commands/optimize_result.test.ts asserts that after do() the three atom metas read
      (0.10, 0, 0), (0.90, 0, 0) and (0, 0.05, 0) angstrom, matching the plan exactly.
    status: pending
  - id: ac-002
    summary: undo() restores the pre-optimize coordinates exactly
    type: runtime
    pass_when: |
      After do() then undo(), the same three atom metas read (0, 0, 0), (1, 0, 0) and (0, 0, 0),
      i.e. the values captured inside do(), not values passed to the constructor.
    status: pending
  - id: ac-003
    summary: Added hydrogens and their bonds are reversible as one action
    type: runtime
    pass_when: |
      A plan with elements.length === baseAtomCount + 2 creates exactly 2 edit-pool atoms and the
      planned new bonds on do(); after undo() the edit-pool atom count is back to baseAtomCount and
      no orphan bond remains.
    status: pending
  - id: ac-004
    summary: The staging command never rebuilds the scene
    type: runtime
    pass_when: |
      Spies record 0 calls to applyPipeline, registerAtomFrame, setFrameData and
      promoteFrameToEditPool across do(), undo() and redo, and exactly one ScenePaintTick.flush
      per do() and per undo().
    status: pending
  - id: ac-005
    summary: undo before do refuses with a descriptive error
    type: runtime
    pass_when: |
      Calling undo() on a never-executed StageOptimizeResultCommand rejects with an Error whose
      message names the command and says it has not been executed.
    status: pending
  - id: ac-006
    summary: The direct-to-HEAD publish path is gone
    type: code
    pass_when: |
      stage/src/optimize/structure.ts contains no ensureDataSourceAndDraws, no buildResultFrame,
      no waitForNextEngineFrame and no applyPipeline call, and imports
      StageOptimizeResultCommand from ../commands/optimize_result; `npm run typecheck:stage` passes.
    status: pending
  - id: ac-007
    summary: A finished run leaves the scene dirty with the persistent save hint
    type: runtime
    pass_when: |
      tests/optimize/structure.test.ts asserts that after runOptimize resolves,
      sceneIndex.hasUnsavedChanges is true and the app emitted info-text-change with the literal
      "Optimized — Ctrl+S to save"; a cancelled result stages the same way.
    status: pending
  - id: ac-008
    summary: The unsaved-scene gate still blocks a dirty start
    type: runtime
    pass_when: |
      runOptimize on a scene with hasUnsavedChanges true rejects with UnsavedSceneError
      (code "UNSAVED_SCENE") and the edit pool is untouched (0 writeAtom calls).
    status: pending
  - id: ac-009
    summary: Regression script reproduces staged / undone / redone goldens
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-03-command.ts` exits 0 and
      prints "optimize-staging-03-command ok"; it asserts the literal coordinates above and that
      stage/dist/optimize/structure.js no longer contains "ensureDataSourceAndDraws" — with no
      subprocess and no third-party tool.
    status: pending
  - id: ac-010
    summary: Command documents the execution-model contract
    type: docs
    pass_when: |
      stage/src/commands/optimize_result.ts documents that it carries no @command decorator,
      that undoability requires app.commandManager.execute, that state is captured in do(), and
      that it must never call applyPipeline / registerAtomFrame / setFrameData.
    status: pending
---

# Acceptance criteria

- **ac-001..003** 是 do/undo 对称铁律的可执行形态：坐标、新增氢、键三者都可逆且作为一个动作。
- **ac-004** 是编辑池不变量的负例门（实时/暂存路径绝不重建场景）。
- **ac-006** 锁单一行为：直发路径删净，静态可验证。
- **ac-007/008** 锁暂存语义两端：结束变脏 + 开始必须干净。
- **ac-009** 回归例同时验证行为 golden 与「双路径已删」的构建产物扫描。
