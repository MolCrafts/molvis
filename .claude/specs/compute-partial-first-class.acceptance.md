---
spec: compute-partial-first-class
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Rings is a visible Compute catalog entry
    type: runtime
    pass_when: "User-facing Compute picker lists Rings (or equivalent label); running it on a bonded ring molecule yields numRings > 0 and a size histogram or table"
    status: pending
  - id: ac-002
    summary: Rings exposes atom mask to selection or coloring
    type: runtime
    pass_when: "After a successful rings run, UI offers select-by-mask or add Color-by-property / selection path that uses atomRingMask length equal to nAtoms"
    status: pending
  - id: ac-003
    summary: Catalog series/histogram entries are reachable
    type: code
    pass_when: "No shipped molrs series/histogram compute id required by product is hidden-only; each has a panel path (dedicated or Generic) with Run"
    status: pending
  - id: ac-004
    summary: Bond distribution chart exists when catalog supports it
    type: runtime
    pass_when: "If molrs exports bond length or angle distribution, page can run it and show a bar/line result; if not exported, acceptance notes oos with catalog evidence"
    status: pending
  - id: ac-005
    summary: Chart-only analyses stay out of pipeline Add menu
    type: code
    pass_when: "Rings/series/bond charts are not registered as pipeline modifiers unless they write frame columns or canvas state by design"
    status: pending
out_of_scope:
  - Structure identification CNA/PTM
  - Worker offload
---

# Acceptance — compute-partial-first-class

partial compute 能力在左栏可发现、可运行，并在有 mask/列时能连到选中或上色。
