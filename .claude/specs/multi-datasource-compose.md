---
slug: multi-datasource-compose
status: approved
created: 2026-08-10
priority: P2
summary: Productize multi-DataSource compose (align, enable, trajectory index) beyond partial OVITO Combine.
---

# Multi–DataSource compose product model

## Summary

MolVis 用 **多个 DataSource** 组合代替 OVITO「Combine datasets」modifier
（parity = partial）。实现上 `composeSources` 已存在，但用户故事（对齐、
启停、轨迹帧索引、谁是 primary）偏实现细节。本 spec 把 **多源场景** 做成
可理解产品：Empty Scene 不变量保留，augment / replace 语义清晰，UI 可操作。

## Domain basis

| Fact | Evidence |
|------|----------|
| 单场景路径 | notes：length-1 trajectory 语义 + ≥1 primary DS；remove last → Empty Scene |
| Compose | `stage/src/pipeline/pipeline.ts` Phase A `composeSources` |
| DS 类型 | `FileDataSource` / `MemoryDataSource` 等 `data_source.ts` |
| OVITO | Combine datasets = partial；不同模型 |
| Entry 双生命周期 | `pipeline/entry.ts` 注释：addDataSource vs addModifier |

## Design

### 1. 用户概念

| 概念 | 含义 |
|------|------|
| **Primary** | 管道头「主」源；File replace 替换它；Empty Scene 保底 |
| **Augment sources** | 额外 DS，compose 进同一工作帧 |
| **Enable** | 每源可开关，不删 |
| **Frame index** | 多帧源与 primary 轨迹 scrub 的对齐策略（见下） |

### 2. 对齐策略（锁定默认）

- **Default：`index-clamp`** — 各源取 `min(frameIndex, source.length-1)`。
- 可选后续：`index-strict`（长度不一则 alert）— 本 spec 实现 default + UI
  展示每源帧数；strict 作 advanced 或 defer。

### 3. Compose 语义

- 原子/键合并规则 **文档化**（现实现行为写成用户/开发者可查的一节，而不是
  沉默）。
- 若当前实现是「拼接 block / 覆盖」等，禁止在无测情况下改数值行为；本 spec
  以 **文档 + UI + 测试钉住现行为** 为主，行为变更另开 supersede。

### 4. UI

- Pipeline / Sources 列表：primary 标记、enable 开关、帧数、文件名。
- Load：**Replace primary** vs **Add source** 明确按钮/菜单，不再含糊。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `composeSources` | reuse | 不重写算法 unless bug |
| `empty_scene.ts` | reuse | 不变量保持 |
| OVITO Combine modifier | — | 不做成 modifier；保持多 DS 模型 |

## Files

| Path | Role |
|------|------|
| `stage/src/pipeline/{pipeline,data_source,compose*}.ts` | 语义钉住 |
| `page` pipeline / source UI | Replace vs Add、enable |
| `docs/tutorial/pipeline.md` 或等价 | 用户文档 |
| `stage/tests/pipeline/*` | 多源 compose 回归 |

## Tasks

1. **Document** compose merge rules + frame index policy from code.
2. **UI** primary badge、enable、Replace vs Add source。
3. **Test** two-source compose；disable one；remove last → Empty Scene。
4. **Update** ovito-parity Combine 行：partial → done（产品模型）或注明 documented partial。

## Testing

- Pipeline unit tests with two MemoryDataSources。

## Out of scope

- 任意晶格配准 / RMSD 自动叠合（superposition 另模块已有则只链接，不新做）。
- OVITO 式 modifier 包装 Combine。
