---
spec: optimize-worker-ship
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Optimize production path runs only via shared compute worker
    type: code
    pass_when: "Public optimize entry used by page does not call full relax on the main thread; it goes through runOptimizeOnWorker / WorkloadHost"
    status: pending
  - id: ac-002
    summary: Cancel stops an in-flight optimize job
    type: runtime
    pass_when: "core or stage test sends cancel mid-run and result has cancelled true without writing a partial committed frame in the host apply path"
    status: pending
  - id: ac-003
    summary: Progress beats reach the main thread
    type: runtime
    pass_when: "A fake or real worker emits at least one OptimizeProgress (status or step) and the host callback receives it before done"
    status: pending
  - id: ac-004
    summary: Result writeback is immutable and DS-preserving
    type: code
    pass_when: "Successful apply creates/replaces frame data through existing scene path; primary DataSource remains; no in-place mutation of the pre-optimize Frame object"
    status: pending
  - id: ac-005
    summary: Existing optimize numerical tests stay green
    type: runtime
    pass_when: "stage tests under tests/optimize/ and core workload_host tests pass"
    status: pending
out_of_scope:
  - Analysis jobs on the same worker (workload-analysis-jobs)
  - New potentials/optimizers
---

# Acceptance — optimize-worker-ship

结构优化在 UI 上可运行、可取消、有进度，且计算不堵死主线程。
