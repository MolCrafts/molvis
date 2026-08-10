---
spec: ui-resize-coalesce
created: 2026-08-10
criteria:
  - id: ac-001
    summary: Drag moves coalesce engine/container resize
    type: runtime
    pass_when: "Simulated rapid drag updates invoke at most one resize per animation frame (or documented equivalent throttle), not one per pointer event"
    status: pending
  - id: ac-002
    summary: Pointer-up flushes final size
    type: runtime
    pass_when: "After drag end, exactly one final resize runs with the committed panel width"
    status: pending
  - id: ac-003
    summary: Keyboard resize end still correct
    type: runtime
    pass_when: "Existing keyboard panel resize still ends with layout matching slot width and a resize flush"
    status: pending
out_of_scope:
  - Replacing the resizable component library
---

# Acceptance — ui-resize-coalesce

双轨拖拽流畅，WebGL resize 不再跟手每事件触发。
