---
slug: optimize-staging-01-positions
criteria:
  - id: ac-001
    summary: EditPoolPositions writes only translation and xyz, preserving scale/radius
    type: runtime
    pass_when: |
      tests/edit_pool_positions.test.ts asserts that after writeAtom(id, 1.5, -2.25, 0.5)
      matrix[idx*16+12..14] === [1.5, -2.25, 0.5], instanceData[idx*4+0..2] === [1.5, -2.25, 0.5],
      and matrix[idx*16+0], [5], [10] plus instanceData[idx*4+3] are byte-identical to their pre-write values.
    status: verified
    last_checked: 2026-08-15
  - id: ac-002
    summary: Position writes resolve through renderIndicesForLogicalId, never raw id
    type: runtime
    pass_when: |
      A fake ImpostorState whose idToIndex maps logical id 7 to edit index 2 with frameOffset 5
      receives the write at absolute row 7; a logical id absent from every map produces zero
      buffer mutations and no throw.
    status: verified
    last_checked: 2026-08-15
  - id: ac-003
    summary: Partial dirty lane only; highlight-wiping paths untouched
    type: runtime
    pass_when: |
      tests/edit_pool_positions.test.ts records markDirty called exactly once with
      ("matrix", "instanceData"), markAllDirty call count 0, and sceneIndex.updateAtom
      called with no bufferUpdates argument.
    status: verified
    last_checked: 2026-08-15
  - id: ac-004
    summary: A bond shared by two moved atoms rebuilds exactly once per tick
    type: runtime
    pass_when: |
      refreshBondsAround([a, b]) for a topology where bond 0 joins a and b results in exactly
      one updateBond call for bond 0.
    status: verified
    last_checked: 2026-08-15
  - id: ac-005
    summary: ScenePaintTick.flush keeps the paint -> dirty -> highlight order
    type: runtime
    pass_when: |
      tests/edit_pool_positions.test.ts records the call order
      ["applySceneIndexToMeshes", "markAllUnsaved", "invalidateAndRebuild"], one call each.
    status: verified
    last_checked: 2026-08-15
  - id: ac-006
    summary: ManipulateMode keeps no private position writer
    type: code
    pass_when: |
      stage/src/mode/manipulate.ts contains no definition of writeAtomPosition, refreshBondsAround,
      refreshBond or flushVisuals, and imports EditPoolPositions and ScenePaintTick from
      ../edit_pool_positions; `npm run typecheck:stage` passes.
    status: verified
    last_checked: 2026-08-15
  - id: ac-007
    summary: Regression script reproduces the hard-coded buffer goldens
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-01-positions.ts` exits 0 and
      prints "optimize-staging-01-positions ok"; it imports only ../stage/dist/edit_pool_positions.js,
      asserts the literal coordinates 1.5 / -2.25 / 0.5 and the dirty-buffer set
      ["matrix","instanceData"], and starts no external process.
    status: verified
    last_checked: 2026-08-15
  - id: ac-008
    summary: New module documents units and the no-buffer-maps rule
    type: docs
    pass_when: |
      stage/src/edit_pool_positions.ts carries a module docstring plus per-method JSDoc stating
      coordinates are angstrom, that updateAtom is called meta-only on purpose, and that the class
      never calls registerAtomFrame / setFrameData / applyPipeline.
    status: pending
---

# Acceptance criteria

- **ac-001/002/003** 锁抽取的行为保真：只写平移与 xyz、只走 id 映射、只标局部脏——三条正是拖拽路径今天的隐式契约。
- **ac-004/005** 锁「一 tick 一次」与上屏顺序（顺序错 = 高亮闪没）。
- **ac-006** 是单一写入口的静态门。
- **ac-007** 回归例用构建产物 + 纯 fake，硬 golden。
- **ac-008** 把负例（不许走的路径）写进文档。
