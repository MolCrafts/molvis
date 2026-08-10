---
spec: coordinate-frame-policy
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Pipeline applies one coordinate policy after compose
    type: code
    pass_when: "There is a single documented pipeline step or System setting that applies CoordinatePolicy after DataSource compose and before draw modifiers read coordinates"
    status: pending
  - id: ac-002
    summary: Wrap-molecules matches prior WrapPBC semantics
    type: runtime
    pass_when: "Existing or migrated tests for molecule-aware wrap still pass when driven through the policy API"
    status: pending
  - id: ac-003
    summary: Draws do not re-implement independent atom wrap
    type: code
    pass_when: "grep/audit of draw_ribbon and bond draw paths shows no second full-frame wrap into cell outside the policy module"
    status: pending
  - id: ac-004
    summary: Default policy is as-deposited
    type: runtime
    pass_when: "Fresh Empty Scene / load without user wrap leaves deposited coordinates unchanged by the policy step"
    status: pending
  - id: ac-005
    summary: Volumetric cell-aligned files keep periodic MC path
    type: code
    pass_when: "CHGCAR/CUBE (or equivalent) isosurface path still uses file grid + periodic treatment; not forced onto atom-AABB density path"
    status: pending
out_of_scope:
  - Symmetry operators / new replicate semantics
  - Changing Gaussian density atom-AABB product decision
---

# Acceptance — coordinate-frame-policy

全管线只有一套坐标策略；Draw 与 MI 视觉不再各写一套 wrap。
