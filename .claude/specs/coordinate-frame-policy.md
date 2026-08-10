---
slug: coordinate-frame-policy
status: approved
created: 2026-08-10
priority: P1
summary: Single post-DataSource coordinate policy consumed by all Draws and MI-aware visuals.
---

# Unified coordinate-frame policy

## Summary

PBC / 坐标语义今天分散：`WrapPBCModifier` 是唯一把原子塞进胞的路径；Ribbon
MI、Bond 绘制、Gaussian density 各自决定是否 wrap。open-questions 已定产品
方向：**在 DataSource compose 之后、transforms/draws 之前** 提供单一 policy，
所有下游只消费 post-policy frame。

## Domain basis

| Fact | Evidence |
|------|----------|
| 债列表 | `.claude/notes/open-questions.md` Remaining debt |
| Wrap 仅一处动原子 | `stage/src/modifiers/WrapPBCModifier.ts` molecule-aware wrap |
| Unwrap 是 modifier | `UnwrapTrajectoriesModifier` |
| Box 可用性 | `stage/src/io/box_presence.ts` `shouldDrawBox` |
| Density 已改为 atom AABB | open-questions：Gaussian / Construct surface `pbc=false` + pad |
| Ribbon MI | `draw_ribbon.ts` / ribbon orientation 注释 |
| Bond plane MI | `artist/bond_plane.ts` |
| 不变式 | pipeline 唯一 ingress；immutability |

## Design

### 1. Policy 枚举（产品名）

```ts
type CoordinatePolicy =
  | "as-deposited"      // 默认：加载坐标原样
  | "wrap-atoms"        // 每原子进胞
  | "wrap-molecules"    // 现 WrapPBC 语义（连通分量）
  | "unwrap-trajectory" // 轨迹 MIC 累积（可与现 Unwrap modifier 对齐或取代）
```

- **默认** `as-deposited`（不静默改坐标）。
- Policy 落点：compose 之后的 **系统级步骤**（pipeline 固定 slot 或
  `System`/`SceneSession` 配置），**不是** 每个 Draw 私自 wrap。
- 用户面：Settings 或 Modification 区单一控件；`Wrap PBC` modifier 可变为
  该 policy 的 UI 别名或薄封装（本 spec 选定一种，见 Tasks）。

### 2. 消费规则

| 消费者 | 规则 |
|--------|------|
| Particles / Bonds / 所有 Draws | 只读 post-policy `frame` 坐标 |
| Ribbon chain split / MI | 使用 policy 后坐标；禁止第二套 wrap |
| Bond draw MI | 与 policy 一致：wrap-molecules 后不再二次跨胞拉直 unless 文档规定 |
| Gaussian density / surface | 保持 atom-AABB + `pbc=false`（与 cell-aligned 体积文件路径分离） |
| CHGCAR/CUBE 等体积场 | **例外**：原生格点仍用 file box + periodic MC（open-questions #4） |

### 3. 与现有 modifier 关系

- **迁移策略（锁定）**：保留 `WrapPBC` / `Unwrap` 在 Add 菜单一段时间，内部
  委托 policy API；新代码禁止旁路。
- `classifyFrameTransition`：policy 改变坐标 ⇒ 至少 `"position"`；改变拓扑
  无关时不要 `"full"` 误触发。

### 4. 测试锚点

- 分子跨胞：wrap-molecules 后键长不飞。
- as-deposited：mmCIF ASU 蛋白可在胞外，density 仍对齐原子（已有修复不回退）。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `WrapPBCModifier` 算法 | reuse | 抽到 `stage/src/coords/`（或类似）pure 函数，modifier/policy 共用 |
| `UnwrapTrajectoriesModifier` | reuse | unwrap-trajectory policy 复用其 MIC 逻辑 |
| `shouldDrawBox` | reuse | policy 启用前提 |
| 各 Draw 内 ad-hoc wrap | — | **删除/收敛**，不 generalize 多套 |

## Files

| Path | Role |
|------|------|
| `stage/src/coords/*`（新）或 `pipeline/coordinate_policy.ts` | policy 实现 |
| `stage/src/modifiers/WrapPBCModifier.ts` | 委托 |
| `stage/src/modifiers/UnwrapTrajectoriesModifier.ts` | 委托/对齐 |
| `stage/src/pipeline/pipeline.ts` | compose 后应用 |
| `stage/src/pipeline/draw_ribbon.ts`、`artist/bond_plane.ts` | 消费 post-policy |
| `page` Settings 或 modifier UI | 用户控件 |
| `stage/tests/…` | wrap/unwrap 回归 |

## Tasks

1. **Extract** molecule-aware wrap + atom wrap + unwrap 为 pure 模块。
2. **Insert** pipeline slot：compose → **policy** → transforms → draws。
3. **Migrate** WrapPBC / Unwrap 到委托；文档更新 ovito-parity 注记。
4. **Audit** Ribbon / Bond / density 路径，去掉重复 wrap。
5. **Test** 跨胞分子、as-deposited 蛋白+density、policy 切换不破坏 Empty Scene 不变量。

## Testing

- Unit on pure coords + pipeline integration with small frames.
- 不改 molrs；科学行为对齐现 WrapPBC 测试若存在则迁移。

## Out of scope

- 新晶体学对称操作 / supercell 重建（Replicate 已独立）。
- 改变 CHGCAR/CUBE 体积周期语义。
- OVITO 式 Python 坐标脚本。
