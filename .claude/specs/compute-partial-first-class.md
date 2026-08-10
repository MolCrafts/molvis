---
slug: compute-partial-first-class
status: approved
created: 2026-08-10
priority: P1
summary: Promote rings, series/histogram/scatter, and bond distributions to first-class Compute UX with optional scene paint.
---

# Compute partials → first-class entries

## Summary

OVITO parity 表里多项 analysis 仍是 **partial**：`detectRings` 仅 helper；
time series / histogram / scatter 偏 catalog-driven；bond 长度/角度/order
分布多是 charts only。本 spec 把它们做成 **Compute 左栏一等入口**：可发现、
可 Run、有结果视图，并在能上色/选中时提供 **Add pipeline modifier** 出口。

## Domain basis

| Fact | Evidence |
|------|----------|
| Rings helper | `stage/src/analysis/rings.ts` `detectRings` → SSSR + `atomRingMask` |
| Catalog 驱动 | `registry.ts` + `GenericAnalysisPanel.tsx` |
| Cluster 已是完整范例 | Cluster 写列 + Color by Property 出口 |
| 表单规范 | `.claude/notes/compute-form-design.md` |
| 左右分工 | notes：left compute / right draw；chart-only 不进 pipeline |
| OVITO 行 | `ovito-modifier-parity.md` Find rings / time series / bond distributions = partial |

## Design

### 1. Rings（优先）

- Compute 目录条目：**Rings**（SSSR）。
- 结果：环数量、尺寸直方图、可选环列表；`atomRingMask` → **Select** 或
  **Color by property** 一键（仿 Cluster）。
- 无 bonds：empty title `No rings` / `No bonds`（短空态）。

### 2. Series / histogram / scatter

- 凡 catalog 中 `result_kind` 为 `lineSeries` / `barSeries` / `trajectorySeries`
  且尚无专用面板的，经 **GenericAnalysisPanel** 但必须：
  - 出现在 picker 可见列表（非隐藏 id）
  - 遵守 subjects → algorithm → advanced → result + footer Run
  - 缺 requirement 时 alerts，不静默失败
- Scatter / PCA 已有则只对齐表单规范，不重做算法。

### 3. Bond length / angle / order 分布

- 若 molrs catalog 已导出：Generic 或专用小面板；结果 bar/line。
- **不** 自动变 pipeline modifier；可选「按阈值选键」若已有 selection API，
  否则本 spec 只做 chart + 文档。

### 4. 不做

- CNA/PTM 等 structure ID（oos / 见 `structure-id-boundary`）。
- 把 chart-only 硬塞进 Add-modifier 菜单。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `detectRings` | reuse | 面板调用，不重写 SSSR |
| `GenericAnalysisPanel` / `AnalysisPanelShell` | reuse | series/histogram 主路径 |
| Cluster → Color by Property | pattern | Rings mask 出口同构 |
| `compute-form-design` | pattern | 全部新面板遵守 |
| 新 ring WASM | — | 禁止；已有 molrs Topology |

## Files

| Path | Role |
|------|------|
| `page/src/ui/layout/analysis/*` | RingsPanel 或 Generic 注册 |
| `stage/src/analysis/rings.ts` | 保持 pure；补测 |
| `page/.../useAnalysisCatalog.ts` / picker | 可见性 |
| `stage/tests/analysis/*` | rings + catalog smoke |
| `.claude/notes/ovito-modifier-parity.md` | partial → done 更新（impl 时） |

## Tasks

1. **Ship** Rings Compute entry：Run、histogram、mask → select/color 出口。
2. **Audit** catalog entries：每个 series/histogram/scatter 在 picker 可达且
   empty/alert 正确。
3. **Expose** bond length/angle（及 catalog 已有的 order）分布面板或 Generic 卡片。
4. **Align** 表单骨架到 compute-form-design（可与 `compute-form-design-acceptance`
   分担；本 spec 至少 Rings + 一条 series 达标）。
5. **Test** rings on small cyclic molecule；无键 empty；mask 长度 = nAtoms。

## Testing

- Unit `detectRings` + panel hook with mock frame。
- Catalog visibility 的轻量 registry 测试。

## Out of scope

- Worker 化（`workload-analysis-jobs`）。
- Voronoi / DXA / grain。
- 内部模块 `analysis*` → `compute*` 全量改名（见 form-acceptance 可顺带，非必须）。
