---
slug: ui-empty-states
status: approved
created: 2026-08-10
priority: P2
summary: Short title-only empty states for pipeline and atom-table views.
---

# Pipeline and atom-table empty states

## Summary

`ui-guidelines` 标黄：Empty pipeline 与 atom-table 仍缺 **说明性空态**，但
产品铁律又是 **短标题 only**（不要教程段）。本 spec 补齐空态：**有标题、无
多行 how-to**，与 View 模式右栏、Compute 空态一致。

## Domain basis

| Fact | Evidence |
|------|----------|
| 债 | ui-guidelines Known debt 🟡 |
| 文案规则 | notes / ui-guidelines：`No selection` 式短标题 |
| 相关 UI | pipeline 列表、DataInspector 无原子、Empty Scene |

## Design

| 场景 | Empty 标题（英文产品 copy，可 i18n 后置） |
|------|------------------------------------------|
| Pipeline 无用户 modifier（仅 auto/DS） | `No modifiers` 或现状更贴切的短句 |
| Atom table 无原子 | `No atoms` |
| Bond table 无键 | `No bonds` |
| 过滤后无行 | `No matching atoms` |

- Remedies 放 `title`/tooltip/aria，不放 body 段落。
- Empty Scene 仍是合法场景，不显示 error 语气。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| 现有 empty-state 组件 | reuse | 统一用 product empty primitive |
| Compute empty titles | pattern | 同密度 |

## Files

| Path | Role |
|------|------|
| Pipeline panel 组件（page） | 空态 |
| `DataInspectorPanel.tsx` | 空态 |
| 其它 atom table 入口 | 对齐 |

## Tasks

1. **Inventory** 所有 pipeline / inspector 空分支。
2. **Add** 短标题空态。
3. **Remove** 若有教程段落。
4. **Pass** copy 与 View 右栏密度一致。

## Testing

- 组件渲染空数据不抛；文案快照可选。

## Out of scope

- 完整 i18n 系统。
- Compute 面板空态（属 `compute-form-design-acceptance`）。
