---
spec: structure-id-boundary
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Docs list only shipped structure-ID modifiers as available
    type: docs
    pass_when: "ovito-parity (or linked user doc) states Steinhardt and Solid-liquid as available and lists CNA/PTM/CSP/DXA/Voronoi as out of scope without molrs"
    status: pending
  - id: ac-002
    summary: No stub structure-ID modifiers in registry
    type: code
    pass_when: "Modifier registry structure-identification folder has no placeholder classes that throw 'not implemented' on apply"
    status: pending
  - id: ac-003
    summary: Structure order modifiers do not auto-attach by default
    type: code
    pass_when: "Steinhardt and Solid-liquid matches() remain false (opt-in) per product iron law"
    status: pending
out_of_scope:
  - Implementing new structure identification algorithms
---

# Acceptance — structure-id-boundary

用户与贡献者不会把「没有 CNA」当成回归；边界可查、可执行。
