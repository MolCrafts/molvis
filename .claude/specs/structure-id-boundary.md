---
slug: structure-id-boundary
status: approved
created: 2026-08-10
priority: P1
summary: Document and enforce product boundary for structure identification (shipped vs oos).
---

# Structure identification product boundary

## Summary

MolVis 结构识别只有 **Steinhardt order** 与 **Solid–liquid**（molrs），不是
OVITO 的 CNA/PTM/CSP/DXA 全家桶。parity 表已标 oos，但 UI/文档仍可能让用户
以为「缺功能 bug」。本 spec **钉死边界**：菜单、文档、空态与 Add 菜单不出现
假入口；需要 molrs 后端的项保持 oos 直到 deliberate note。

## Domain basis

| Fact | Evidence |
|------|----------|
| 已实现 | Steinhardt / Solid-liquid modifiers + left config |
| OOS 列表 | `ovito-modifier-parity.md` Structure identification / Analysis |
| 产品排除 | Python modifiers、Voronoi* |
| 着色 partial | Structure → color 走 molrs order，非 PTM |

## Design

### 1. 对外承诺（文档）

在 `docs/development/ovito-parity.md` 与用户向 compute/structure 文档中明确：

| 有 | 无（且不排期除非 molrs） |
|----|---------------------------|
| Steinhardt \(q_l\) 类 order | CNA, PTM, CSP, Chill+, Diamond |
| Solid–liquid | DXA, grain segmentation, Wigner–Seitz |
| | Ackland–Jones, VoroTop |

### 2. 代码侧

- Add 菜单 **不** 注册占位 disabled 项伪装「即将推出」除非产品明确要 waitlist。
- `matches()` / `isApplicable` 保持：结构类 **不** 默认 auto-attach 覆盖 CPK
  （已有 notes 铁律）。
- 若 UI 文案含 “OVITO-compatible structure ID”，改为准确描述 molrs order。

### 3. 扩展闸门

新增结构识别 modifier **仅当** molrs 导出绑定且有数值验收；否则只许开
`/mol:spec`，不许暗加 stub。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| 现有 Steinhardt / Solid-liquid | reuse | 不改算法 |
| ovito-modifier-parity | reuse | 本 spec 同步文档为唯一真相 |
| 假 PTM stub | — | 禁止 |

## Files

| Path | Role |
|------|------|
| `docs/development/ovito-parity.md` | 用户/开发者边界 |
| `.claude/notes/ovito-modifier-parity.md` | 矩阵确认 |
| `docs/` tutorial 或 compute 相关若有误导句 | 修正 |
| modifier 注册表 | 确认无 stub |

## Tasks

1. **Audit** Add 菜单与 docs 中 structure 用词。
2. **Write** 清晰 “Supported / Not planned without molrs” 表。
3. **Remove** 误导性 “full OVITO structure ID” 表述（若有）。
4. **Note** 扩展闸门写进 notes 一条。

## Testing

- 文档 diff 审查；可选 registry 快照测试：structure folder 仅含已知两项（+ 将来合法新增）。

## Out of scope

- 实现 CNA/PTM 等。
- 改 Steinhardt 物理定义。
