---
spec: traj-ingest-02-sidecar
created: 2026-08-18
criteria:
  - id: ac-001
    summary: Codec tests lock v2 round-trip and unknown-version miss
    type: runtime
    pass_when: |
      npm run test -w @molcrafts/molvis-stage -- tests/io/cache/molidx_codec.test.ts
      is green and covers v2 round-trip, hand-built v1 promote, and null
      for molidxVersion 99 / bad magic / truncated input.
    status: pending
  - id: ac-002
    summary: encodeMolidx writes v2; decode reads v1 and v2
    type: code
    pass_when: |
      stage/src/io/cache/molidx_codec.ts encodes only molidxVersion 2
      with the v2 field set; decodeMolidx promotes v1 and returns null
      for any other version.
    status: pending
  - id: ac-003
    summary: Incomplete sidecar resumes and is never a final hit
    type: runtime
    pass_when: |
      decideMolidxUse tests return resume (scannedBytes 2048) for a
      complete=false fixture with fileSize 4096, and miss when
      complete=false and scannedBytes >= fileSize.
    status: pending
  - id: ac-004
    summary: OpfsIndexCache stays on /molvis/v1/idx plus fingerprintFile
    type: code
    pass_when: |
      opfs_index_cache.ts still uses getOpfsBucket("idx") and
      ${safeKey(fingerprint)}.molidx; no /molvis/v2 path.
    status: pending
  - id: ac-005
    summary: handleOpen uses decideMolidxUse and withholds index-ready
    type: code
    pass_when: |
      handleOpen calls decideMolidxUse after OpfsIndexCache.get; hit
      sends index-ready; resume continues runIndexingPass and does not
      send index-ready until the pass finishes.
    status: pending
  - id: ac-006
    summary: Worker checkpoints sidecar and never auto-copies blobs
    type: code
    pass_when: |
      Persist path writes complete=false checkpoints and complete=true
      after finish; no OpfsBlobCache.set on that path.
    status: pending
  - id: ac-007
    summary: Regression locks v2 version word and resume golden
    type: runtime
    pass_when: |
      After npm run build:stage, node regressions/traj-ingest-02-sidecar.ts
      exits 0 and asserts encode version word 2, version 99 decodes null,
      incomplete decideMolidxUse is resume/2048, and a v1 buffer decodes
      complete with entries.length 1.
    status: pending
out_of_scope:
  - core OPFS namespace / fingerprintFile / VERSION_DIR
  - OpfsBlobCache auto-copy
  - beside-file or VS Code workspace cache (traj-ingest-05-remote)
  - page, decideIngest, HostRangeSource
  - Trajectory.length implementation (01)
---

# Acceptance — traj-ingest-02-sidecar

Done = stage 用同一套 `OpfsIndexCache` 在 `/molvis/v1/idx/` 读写 v2 `.molidx`；完整记录秒开；不完整只当检查点；未知版本重扫。
