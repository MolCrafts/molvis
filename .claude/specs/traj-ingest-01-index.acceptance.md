---
spec: traj-ingest-01-index
created: 2026-08-18
criteria:
  - id: ac-001
    summary: Trajectory exposes length, indexedLength, indexComplete
    type: code
    pass_when: |
      Trajectory in stage/src/system/trajectory.ts has public getters
      length: number | null, indexedLength: number, and indexComplete:
      boolean. Eager constructors keep all three in sync (complete).
    status: pending
  - id: ac-002
    summary: File scan must not grow Trajectory.length
    type: runtime
    pass_when: |
      stage/tests/system/trajectory.test.ts fails if recordIndexedLength(1)
      changes length away from null, and passes when length stays null
      while indexedLength becomes 1.
    status: pending
  - id: ac-003
    summary: Playback and seek clamp to indexedLength
    type: runtime
    pass_when: |
      stage/tests/system/trajectory.test.ts shows seek/frame on a scan
      trajectory with indexedLength === 1 reject or clamp index 1+, even
      when length is 4.
    status: pending
  - id: ac-004
    summary: requireCompleteLength gates whole-trajectory consumers
    type: runtime
    pass_when: |
      stage/tests/system/trajectory.test.ts expects requireCompleteLength
      to throw before markIndexComplete and to return the known N after.
    status: pending
  - id: ac-005
    summary: TrajectoryRuntime.open resolves on first FramePos
    type: runtime
    pass_when: |
      stage/tests/transport/trajectory_worker/runtime.test.ts resolves
      open() from IndexProgress { framesIndexedSoFar: 1 } with
      indexComplete === false before any IndexReady, then settles
      whenIndexComplete on IndexReady { frameCount: 7 }.
    status: pending
  - id: ac-006
    summary: Worker emits first FramePos without throttle; dual streams
    type: code
    pass_when: |
      stage/src/transport/trajectory_worker/worker.ts sends IndexProgress
      immediately when state.index grows from 0 to >= 1, and uses two
      existing Wasm*Stream instances (index vs parse) rather than a new
      indexer type or a second Worker.
    status: pending
  - id: ac-007
    summary: FileDataSource.frameCount uses length ?? indexedLength
    type: runtime
    pass_when: |
      stage/tests/pipeline/data_source.test.ts expects frameCount === 1
      and indexComplete === false during scan, and frameCount === 4
      after length is known and the index is marked complete.
    status: pending
  - id: ac-008
    summary: loadFileStream replace installs after first FramePos
    type: code
    pass_when: |
      loadFileStream in stage/src/io/index.ts on mode replace awaits
      runtime.open, then installPrimaryTrajectory, without awaiting
      whenIndexComplete; augment/extend await whenIndexComplete first.
    status: pending
  - id: ac-009
    summary: Whole-trajectory analysis requires complete index or range
    type: runtime
    pass_when: |
      stage/tests/analysis/trajectory_runner.test.ts expects
      resolveVisitLength(incomplete, undefined) to throw and
      resolveVisitLength(incomplete, { start: 0, endInclusive: 0 })
      to use indexedLength.
    status: pending
  - id: ac-010
    summary: Stage emits length-changed and index-complete
    type: code
    pass_when: |
      MolvisEventMap in stage/src/events.ts declares length-changed
      and index-complete payloads with indexedLength/length, and
      loadFileStream emits them from onProgress / onIndexComplete.
    status: pending
  - id: ac-011
    summary: HostRangeSource is a TrajectorySource kind host
    type: runtime
    pass_when: |
      stage/tests/io/sources/host_range_source.test.ts is green;
      HostRangeSource.kind is "host" and readRange forwards to the
      injected function. loadFileStream accepts TrajectorySource.
    status: pending
  - id: ac-012
    summary: Regression locks three-component public API goldens
    type: runtime
    pass_when: |
      regressions/traj-ingest-01-index.ts (no WASM, no worker) asserts:
      empty eager is (0, 0, true); after recordIndexedLength(1) is
      (null, 1, false) and FileDataSource.frameCount === 1; after
      markIndexComplete() length === 1 and requireCompleteLength
      returns 1.
    status: pending
out_of_scope:
  - sidecar read/write (traj-ingest-02-sidecar)
  - VS Code openUri/readRange protocol (traj-ingest-04)
  - page HUD / React filmstrip (traj-ingest-03-hud)
  - decideIngest / ingestKind / threshold changes
  - MolRS DCD / XTC / TRR readers
  - treating StreamDataSource as file ingest
  - new Dedicated Worker or FormatIndexer
  - parsing a header N
---

# Acceptance — traj-ingest-01-index

Done = 固定大小的流式文件可以在第一个 `FramePos` 闭合后进入场景；`Trajectory.length` 不是扫描计数器；播放只用 `indexedLength`；整轨分析必须 complete 或显式范围；`HostRangeSource` 可供 04 注入。
