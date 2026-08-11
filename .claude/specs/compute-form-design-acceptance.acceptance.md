---
spec: compute-form-design-acceptance
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Every shipped compute panel has footer Run bar anatomy
    type: code
    pass_when: "RDF, MSD, Cluster, Generic, and Optimize panels render primary actions in a pinned footer run bar pattern (shared component or equivalent), not mid-scroll only"
    status: verified
    last_checked: 2026-08-11
  - id: ac-002
    summary: No tutorial empty states in compute rail
    type: code
    pass_when: "Empty states for these panels are title-only strings; no multi-sentence how-to paragraphs in empty bodies"
    status: verified
    last_checked: 2026-08-11
  - id: ac-003
    summary: No orphan grid layouts in primary param rows
    type: code
    pass_when: "Primary param grids use full-width, 2-col peer, or 3-col peer only; no 3 fields forced into 2-col leaving a hole"
    status: verified
    last_checked: 2026-08-11
  - id: ac-004
    summary: User-facing product name is Compute
    type: runtime
    pass_when: "Visible tab/shell labels use Compute (not Analysis) for the left science rail"
    status: verified
    last_checked: 2026-08-11
  - id: ac-005
    summary: compute-form-design acceptance checklist updated
    type: docs
    pass_when: "Notes file acceptance checkboxes reflect post-impl truth for panels in scope"
    status: pending
out_of_scope:
  - stage/analysis path rename
  - plugin analysis.register breaking rename
---

# Acceptance — compute-form-design-acceptance

左栏 Compute 表单密度与骨架一致，用户只看到 Compute，不再有 SaaS 教程空态。
