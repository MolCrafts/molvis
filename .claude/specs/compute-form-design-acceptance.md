---
slug: compute-form-design-acceptance
status: approved
created: 2026-08-10
priority: P1
summary: Make every Compute panel meet compute-form-design anatomy and rename debt policy.
---

# Compute form design — full acceptance

## Summary

`.claude/notes/compute-form-design.md` 已定窄轨表单规范，但 acceptance 清单
未勾完；内部仍大量 `Analysis*` 命名，用户面已是 **Compute**。本 spec 把
**所有** 左栏 compute 面板（含 Optimize 共用壳若适用）收到同一骨架，并明确
哪些 rename 做、哪些刻意 defer。

## Domain basis

| Fact | Evidence |
|------|----------|
| 规范全文 | `.claude/notes/compute-form-design.md` |
| 用户面已改名 | notes：tab/aria/shell mode → compute |
| 内部 defer | `Analysis*` 组件、`stage/analysis/*`、plugin `analysis.register` |
| 面板集 | `page/src/ui/layout/analysis/*`、`StructureOptimizePanel.tsx` |
| 共享零件 | `ParamStack`、`AnalysisRunBar`、`ResultSection`、`AnalysisPanelShell` |

## Design

### 1. 强制骨架（每个面板）

0. Catalog picker（壳）  
1. Scope（帧；原子 scope 由面板自有 subjects 时隐藏）  
2. Subjects  
3. Algorithm primary（≤6 字段）  
4. Advanced（默认折叠）  
5. Alerts（仅真实条件）  
6. Result（首次 Run 后）  
7. Footer run bar（pinned）

### 2. 窄轨规则

- 240–320px 无横向溢出；禁止 orphan grid cell。
- Auto：短 placeholder + caption 估计，禁止长 Auto 文案占满。
- Derived：meta 一行（如 `ρ from box · V = …`）。
- Empty：仅标题（`No RDF yet`）。
- 数字：tabular-nums + 单位在 label。

### 3. Rename 策略（本 spec 锁定）

| 层 | 本 spec |
|----|---------|
| 用户可见 copy / layout id / shell mode | 必须已是 Compute；回归测文案 |
| `page` 组件文件 `Analysis*` | **允许** 逐步改名，不要求一次 PR 全改；新文件用 `Compute*` |
| `stage/src/analysis/*` 路径 | **defer**（API 稳定） |
| Plugin `analysis.register` | **defer**；文档写明 alias 计划 |

### 4. 基线面板清单（必须过检）

RDF、MSD、Cluster、Generic（catalog）、PCA（若仍挂载）、Rings（若
`compute-partial-first-class` 已合则纳入；否则本 spec 只约束现有面板）、
Optimize（run bar / empty / 密度一致）。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `ParamStack` / `AnalysisRunBar` / `AnalysisPanelShell` | reuse | 统一包裹，禁止面板私自 footer |
| RdfPanel 作 baseline | pattern | 其它面板抄其 grid/caption 模式 |
| 全量 `analysis`→`compute` 重命名 | — | 仅用户面 + 新文件；不做大爆炸 move |

## Files

| Path | Role |
|------|------|
| `page/src/ui/layout/analysis/*` | 逐面板对齐 |
| `page/src/ui/layout/StructureOptimizePanel.tsx` | 密度与 run bar |
| `.claude/notes/compute-form-design.md` | acceptance 勾选更新 |
| 可选 `page` 视觉/rtl 测 | 宽度 240 断言若可测 |

## Tasks

1. **Audit** 每个现有 compute 面板 vs 骨架 + 反模式表。
2. **Fix** 违反项（orphan grid、tutorial empty、双表单左右重复算法等）。
3. **Normalize** Run bar / stale / empty title。
4. **Document** rename defer 边界进 notes（impl 时 `/mol:note` 一句即可）。
5. **Check** 240px 宽度无溢出（组件测或 story/rtl 快照择一）。

## Testing

- 组件级：关键 props 渲染不抛；可选 width container。
- 无 Playwright e2e 硬性要求。

## Out of scope

- 新 analysis 算法。
- 插件公共 API 改名 breaking。
- stage 目录物理 rename。
