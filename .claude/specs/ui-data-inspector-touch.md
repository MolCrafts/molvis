---
slug: ui-data-inspector-touch
status: approved
created: 2026-08-10
priority: P2
summary: Fix DataInspector coarse-pointer row geometry and selection semantics vs virtualized 20px rows.
---

# DataInspector touch / row geometry

## Summary

`ui-guidelines` 标红：`DataInspectorPanel` 粗指针行高/点选语义与虚拟列表
`ROW_HEIGHT = 20` 不一致。本 spec 对齐 **行高、hit target、选择**，使触控与
鼠标都选到正确原子/键行。

## Domain basis

| Fact | Evidence |
|------|----------|
| 债 | `.claude/notes/ui-guidelines.md` Known debt 🔴 |
| 实现 | `page/src/ui/layout/DataInspectorPanel.tsx` `ROW_HEIGHT = 20` |
| 虚拟化 | scrollTop + overscan 窗口 |
| 选择 | 与 `selectionManager` 双向同步 |

## Design

### 1. 几何

- **Fine pointer**：可保持 20px 科学密度。
- **Coarse pointer**（`pointer: coarse` 或现有 coarse token）：行高 ≥ 44px
  触控目标（或 padding 扩大 hit 区且虚拟索引映射正确）。
- 虚拟窗口计算必须用 **同一** 有效行高变量，禁止 CSS 与 JS 各写各的。

### 2. 选择语义

- 点击行：toggle/select 对应该数据行的 atom/bond id（映射不因行高漂移）。
- 与 canvas 选择同步不丢；filterAtomIds 下索引正确。

### 3. 视觉

- 选中行状态对比度符合现有 dark 主题；不引入新卡片样式。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| 现有 virtualizer 手写逻辑 | reuse | 修映射，不换重库 unless 必要 |
| `resizeTargetMinimumSize` coarse 44 | pattern | 与 App 触控预算一致 |

## Files

| Path | Role |
|------|------|
| `page/src/ui/layout/DataInspectorPanel.tsx` | 主修 |
| 可选 `page` 测试 | 行高映射 unit |

## Tasks

1. **Unify** row height token for layout + virtualizer.
2. **Coarse** hit target ≥ 44px effective.
3. **Fix** click → id mapping under filter + scroll.
4. **Test** index math helper if extracted.

## Testing

- Unit on row index from scroll/y；无 e2e。

## Out of scope

- 整表换成第三方 grid。
- 编辑单元格写回 frame（只读 inspector 保持）。
