---
spec: ui-data-inspector-touch
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Virtualizer and CSS share one row height
    type: code
    pass_when: "A single constant or media-dependent height drives both transform offsets and row style height"
    status: pending
  - id: ac-002
    summary: Coarse pointer rows meet minimum hit size
    type: code
    pass_when: "Under coarse pointer, effective row hit height is ≥ 44px"
    status: pending
  - id: ac-003
    summary: Click maps to correct atom id after scroll
    type: runtime
    pass_when: "Unit test or logic test: given scrollTop and clientY, resolved row index matches data row used for selection"
    status: pending
out_of_scope:
  - Editable cells
  - New grid library
---

# Acceptance — ui-data-inspector-touch

DataInspector 在触控与鼠标下点选与虚拟行一致，无错行。
