---
spec: multi-datasource-compose
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Replace vs Add source is explicit in UI
    type: runtime
    pass_when: "Page (or stage gui) offers distinct user actions for replace-primary vs add-augment data source"
    status: pending
  - id: ac-002
    summary: Sources list shows primary and enable state
    type: runtime
    pass_when: "Multi-source pipeline UI marks primary and can toggle enable without deleting the source"
    status: pending
  - id: ac-003
    summary: Frame index policy is documented and tested
    type: docs
    pass_when: "Docs state default index-clamp (or actual code default) and a unit test covers two sources of different lengths"
    status: pending
  - id: ac-004
    summary: Empty Scene invariant holds
    type: runtime
    pass_when: "Removing the last data source reinstalls Empty Scene primary; never zero-DS pipeline"
    status: pending
  - id: ac-005
    summary: Compose merge behavior has a regression test
    type: runtime
    pass_when: "stage test asserts atom/bond counts (or ids) after composing two known MemoryDataSources"
    status: pending
out_of_scope:
  - Auto lattice registration
  - OVITO Combine modifier clone
---

# Acceptance — multi-datasource-compose

多源加载对用户可解释、可操作，并且有测试钉住 compose 与 Empty Scene。
