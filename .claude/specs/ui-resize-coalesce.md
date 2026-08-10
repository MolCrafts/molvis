---
slug: ui-resize-coalesce
status: approved
created: 2026-08-10
priority: P2
summary: Coalesce core container resize calls during live two-rail drag.
---

# Coalesce resize during two-rail drag

## Summary

双轨（左 Compute / 右工具）拖拽改宽时，core/viewer **resize 调用未合并**，
导致拖动卡顿或多余 WebGL resize（ui-guidelines 🟡）。本 spec 在 **pointer
move 期间合并** resize，pointer up / 键盘调整结束时再 commit 一次确定性
resize。

## Domain basis

| Fact | Evidence |
|------|----------|
| 债 | ui-guidelines：Core container resize not coalesced during live two-rail drag |
| 布局 | `page/src/App.tsx` slot.resize；`viewer-layout.ts` 限制 |
| 侧栏 | `ViewerSidePanel.tsx` panelRef 宽度 |
| 引擎 | stage canvas resize / Babylon engine.resize |

## Design

### 1. 策略

- **During drag**（pointer move）：`requestAnimationFrame` 或 rAF 节流，
  **每帧最多一次** `app`/`engine` resize（或只改 CSS，松手再 engine.resize —
  二选一，优先 **rAF 合并 engine.resize** 以保持画质）。
- **On pointer up / blur / keyboard resize end**：强制 flush 一次最终尺寸。
- 已有 “Committed layout” 路径（App.tsx 注释）对齐，不双写打架。

### 2. API

- 若 stage 暴露 `scheduleResize()` / `resize({ immediate })`，page 只调它。
- 不在 core 引入 chart 依赖；resize 仍在 stage/page 边界。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| App 现有 resize handlers | reuse | 包一层 coalesce |
| trajectory camera rAF | pattern | 同帧合并思路 |

## Files

| Path | Role |
|------|------|
| `page/src/App.tsx` | drag 路径 |
| `page/src/components/viewer/*` | 若宽度在此更新 |
| `stage` viewer/app resize 入口 | 可选 schedule API |
| 测试 | 假 clock 下调用次数 |

## Tasks

1. **Instrument** 当前 drag 期间 resize 调用点。
2. **Add** rAF/coalesce helper。
3. **Flush** on drag end。
4. **Test** N moves → ≤ N frames calls + 1 flush。

## Testing

- Unit with mock rAF；计数 resize 调用。

## Out of scope

- 改 resizable 库。
- 移动端抽屉重构。
