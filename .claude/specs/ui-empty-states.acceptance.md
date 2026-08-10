---
spec: ui-empty-states
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Pipeline empty shows short title
    type: runtime
    pass_when: "When pipeline has no user-facing modifiers to list, UI shows a short empty title without multi-sentence tutorial body"
    status: pending
  - id: ac-002
    summary: Atom table empty shows short title
    type: runtime
    pass_when: "DataInspector with zero atoms shows a short empty title (e.g. No atoms)"
    status: pending
  - id: ac-003
    summary: No multi-line how-to in these empty bodies
    type: code
    pass_when: "Empty body content is title-level only; help is tooltip/aria if present"
    status: pending
out_of_scope:
  - Compute rail empties (other spec)
  - i18n framework
---

# Acceptance — ui-empty-states

Pipeline 与 atom table 空态短、清，不说教。
