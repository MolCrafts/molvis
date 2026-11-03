---
spec: traj-ingest-00-molrs
created: 2026-08-18
criteria:
  - id: ac-001
    summary: MolRS is the only frame indexer and decoder
    type: code
    pass_when: |
      stage worker makeStream only constructs classes imported from
      @molcrafts/molvis-core/molrs. vsc-ext/src and page/src contain no
      parallel trajectory frame-boundary scanner (no ITEM: TIMESTEP /
      XYZ-N / $$$$ index loops).
    status: verified
    last_checked: 2026-08-18
    verified_by: agent
  - id: ac-002
    summary: Text trajectory streams already exist on the molrs export
    type: runtime
    pass_when: |
      @molcrafts/molvis-core/molrs exports WasmLammpsDumpStream,
      WasmXyzStream, WasmPdbStream, WasmSdfStream with feedIndexChunk
      and parseRangeInInput (or the current equivalent names).
    status: verified
    last_checked: 2026-08-18
    verified_by: agent
  - id: ac-003
    summary: DCD/XTC/TRR expose the same stream surface
    type: runtime
    pass_when: |
      regressions/traj-ingest-00-molrs.ts exits 0 only when molrs
      exports stream types for dcd, xtc, and trr that can build a
      FrameIndexEntry table from byte ranges and decode one frame from
      one range. Until molrs ships them the regression stays red —
      that is the bar, not a skip.
    status: pending
    last_checked: 2026-08-18
    note: Implemented in molrs (WasmDcdStream/WasmXtcStream/WasmTrrStream + FrameIndexBuilder). Published @molcrafts/molrs 0.13.1 d.ts still lacks the classes — regression stays red until that package is published.
  - id: ac-004
    summary: MolRS has no DataSource, ssh, or http
    type: code
    pass_when: |
      @molcrafts/molvis-core/molrs and its re-exports do not mention
      DataSourceKind, ssh, or http as trajectory acquisition types.
    status: verified
    last_checked: 2026-08-18
    verified_by: agent
  - id: ac-005
    summary: formats.ts flips binary traj only after molrs streams exist
    type: code
    pass_when: |
      dcd/trr/xtc stay eager-only until the corresponding molrs stream
      class exists; after it exists, canStream is true and worker
      makeStream dispatches to that class.
    status: verified
    last_checked: 2026-08-18
    verified_by: agent
out_of_scope:
  - Implementing binary parsers inside molvis
  - VS Code protocol, OPFS, DataSource subclasses
  - .molidx on-disk layout
---

# Acceptance — traj-ingest-00-molrs

Done = 全仓库只有 MolRS 会切帧/解码；DCD/XTC/TRR 与文本轨迹同一套 stream 面；host 只喂 bytes。
