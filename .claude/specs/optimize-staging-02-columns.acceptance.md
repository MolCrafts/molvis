---
slug: optimize-staging-02-columns
criteria:
  - id: ac-001
    summary: AtomColumnCarrier copies every dtype it is handed
    type: runtime
    pass_when: |
      tests/atom_columns.test.ts asserts F64, U32, I32 and String columns all arrive at the sink
      with the exact source values for an identity row mapping, and an unknown dtype is skipped
      without throwing.
    status: pending
  - id: ac-002
    summary: Rows without a source row take 0 / empty string
    type: runtime
    pass_when: |
      copyInto(dst, rows = nrows + 1, rowFor) where rowFor(nrows) === undefined leaves numeric
      columns 0 and string columns "" on that row, and leaves all mapped rows unchanged.
    status: pending
  - id: ac-003
    summary: Commit no longer drops source atom columns
    type: runtime
    pass_when: |
      tests/build_frame_from_scene.test.ts commits a scene whose source frame carries charge and
      mol_id plus one edit-pool atom, and asserts the materialized frame keeps charge -0.834 on
      the first atom while the added atom reads 0.
    status: pending
  - id: ac-004
    summary: Sparse scene ids stay aligned with their source rows
    type: runtime
    pass_when: |
      After deleting a middle atom, tests/build_frame_from_scene.test.ts asserts each surviving
      dense row carries the charge of its original source row (no off-by-one shift).
    status: pending
  - id: ac-005
    summary: structure.ts holds no second column copier
    type: code
    pass_when: |
      stage/src/optimize/structure.ts contains no `function cloneAtomColumns` and imports
      AtomColumnCarrier from ../atom_columns; `npm run typecheck:stage` passes.
    status: pending
  - id: ac-006
    summary: Regression script reproduces the hard-coded column goldens
    type: runtime
    pass_when: |
      After `npm run build:stage`, `node regressions/optimize-staging-02-columns.ts` exits 0 and
      prints "optimize-staging-02-columns ok"; it asserts the literals -0.834 / 0.417 / 0.417,
      mol_id 1, res_name "HOH", and the padded row 0 / "" — with no molrs import and no subprocess.
    status: pending
  - id: ac-007
    summary: Carrier documents the borrow and row-mapping contract
    type: docs
    pass_when: |
      stage/src/atom_columns.ts documents that the source is only read (never freed, Block is a
      borrow), that callers overwrite x/y/z/element afterwards, and what an undefined source row
      means.
    status: pending
---

# Acceptance criteria

- **ac-001/002** 是搬运器自身的契约（dtype 分派 + 无源行语义）。
- **ac-003/004** 是本条存在的理由：commit 不再丢列，且稀疏删除不串行——今天两者都是静默丢失。
- **ac-005** 锁单一实现（L8 同族：不留第二份拷贝器）。
- **ac-006** 回归例纯 fake 驱动，硬 golden。
- **ac-007** 把 Block-是借用与调用方覆写序写进文档。
