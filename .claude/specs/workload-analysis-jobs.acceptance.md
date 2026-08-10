---
spec: workload-analysis-jobs
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Analysis job is a first-class ComputeJob kind
    type: code
    pass_when: "ComputeJob discriminated union includes an analysis variant with catalog id and plain-data frame snapshot; no molrs object crosses postMessage"
    status: pending
  - id: ac-002
    summary: RDF can run on the compute worker
    type: runtime
    pass_when: "stage test runs RDF via runAnalysisOnWorker (or equivalent) and receives a lineSeries-compatible result"
    status: pending
  - id: ac-003
    summary: Cancel aborts an analysis job
    type: runtime
    pass_when: "Cancel during a long analysis resolves without treating the job as a successful chart update"
    status: pending
  - id: ac-004
    summary: Worker RDF matches main-thread reference on fixture
    type: scientific
    pass_when: "Same small fixture RDF bins match main-thread helper within documented absolute/relative tolerance"
    status: pending
  - id: ac-005
    summary: Optimize and analysis share one serial worker queue
    type: code
    pass_when: "Documentation or test shows a single WorkloadHost/compute runtime queues jobs; no second analysis-only worker module is introduced"
    status: pending
out_of_scope:
  - New analysis algorithms
  - Parallel multi-worker pool
  - Rings UI productization
---

# Acceptance — workload-analysis-jobs

重 analysis 可在 shared compute worker 上跑完、可取消，结果与主线程参考一致。
