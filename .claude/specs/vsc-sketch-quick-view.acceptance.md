---
spec: vsc-sketch-quick-view
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Sketch Quick View command is registered
    type: runtime
    pass_when: "package.json contributes molvis.quickViewSketch (or documented name) and manifest unit test lists it"
    status: pending
  - id: ac-002
    summary: Sketch QV webview does not import page
    type: code
    pass_when: "Sketch QV entry/bundle dependency graph excludes page/src; only sketch/core/stage protocol as needed"
    status: pending
  - id: ac-003
    summary: Stage quickView behavior remains stage-only
    type: code
    pass_when: "molvis.quickView still opens stage controller path; sketch is a separate command/entry"
    status: pending
  - id: ac-004
    summary: Host can load a supported 2D/structure file into sketch QV
    type: runtime
    pass_when: "Unit or integration test of host messages completes load handshake without throw for a fixture path"
    status: pending
  - id: ac-005
    summary: VS Code docs mention Sketch Quick View
    type: docs
    pass_when: "docs/interfaces/vscode documents the surface and when to use it vs Workbench"
    status: pending
out_of_scope:
  - Full ChemDraw feature parity in QV chrome
  - Page-hosted engines
---

# Acceptance — vsc-sketch-quick-view

VS Code 上可用轻量 Sketch Quick View peek 2D，且不破坏 Stage QV 与包边界。
