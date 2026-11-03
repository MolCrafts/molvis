---
spec: traj-ingest-04-range
created: 2026-08-18
criteria:
  - id: ac-001
    summary: Protocol unions list the four range messages
    type: code
    pass_when: |
      HostToWebviewMessage includes openUri and bytes; WebviewToHostMessage
      includes readRange and cancelRange; QUICK_VIEW_HOST_MESSAGE_TYPES
      includes openUri and bytes; loadFile remains for eager payloads.
    status: pending
  - id: ac-002
    summary: MolecularLoadIntent streams huge dumps instead of refusing
    type: runtime
    pass_when: |
      lammps-dump at 536870912 bytes resolves to open-uri; lammps at
      2147483648 bytes resolves to read-bytes; dcd at 536870912 refuses.
    status: pending
  - id: ac-003
    summary: FileRangeReader returns a positional slice
    type: runtime
    pass_when: |
      Reading temp file abcdefghij at [2, 6) equals bytes cdef; cancel
      rejects the matching fetchId.
    status: pending
  - id: ac-004
    summary: Stream loads never call workspace.fs.readFile
    type: code
    pass_when: |
      MolecularFileLoader.load on an open-uri intent returns a uri
      descriptor without readFile/openTextDocument; hostCanRange: true
      is the only decideIngest flag in molecularFileLoader.ts.
    status: pending
  - id: ac-005
    summary: openUri calls loadFileStream with a host TrajectorySource
    type: code
    pass_when: |
      attachStageHost constructs WebviewHostRangeSource (kind host) and
      calls loadFileStream without wrapping a full-file Uint8Array in a Blob.
    status: pending
  - id: ac-006
    summary: VS Code docs describe range open, not 512 MiB refuse
    type: docs
    pass_when: |
      remote.md and troubleshooting.md describe openUri/readRange for
      streamable trajectories and do not claim those files are refused
      at 512 MiB.
    status: pending
  - id: ac-007
    summary: Regression locks ingest policy and protocol literals
    type: runtime
    pass_when: |
      regressions/traj-ingest-04-range.ts exits 0 and asserts
      decideIngest dump 536870912 hostCanRange true === {path:stream},
      same size hostCanRange false .path === refuse, and messages.ts
      text contains openUri, readRange, bytes, cancelRange.
    status: pending
out_of_scope:
  - Remote molidx / near-data indexer (05)
  - New DataSourceKind
  - stage/ API (01)
  - page/ hostCanRange
  - Sketch range
  - Non-file: positional reads
  - DCD/TRR/XTC above 512 MiB
---

# Acceptance — traj-ingest-04-range

Done = 可流式轨迹不再以整包越过 EH↔webview；宿主只 stat + `openUri`，用 Node 定位读回答 `[start,end)`。
