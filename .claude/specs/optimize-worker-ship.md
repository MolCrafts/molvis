---
slug: optimize-worker-ship
status: done
created: 2026-08-10
priority: P0
summary: Ship structure optimize fully on the shared compute workload worker (cancel, progress, host wiring).
---

# Ship structure optimize on the compute worker

## Summary

结构优化（UFF / L-BFGS 等）已有 `stage/src/optimize/*`、`core/src/workload/*` 与
`stage/src/compute/*` 的骨架，但主线程路径与 worker 路径、进度/取消、以及
page / vsc-ext 宿主接线尚未收成可发布的一条路径。本 spec 把 **Optimize 唯一
执行面** 定在 shared compute worker 上，主线程只负责打包 payload、展示
progress、应用结果帧。

## Domain basis

| Fact | Evidence |
|------|----------|
| Core 已有通用 envelope | `core/src/workload/{host,protocol,worker_side}.ts`：`run` / `cancel` / `progress` / `done` / `error` |
| Stage 已有 compute 单例 | `stage/src/compute/runtime.ts`：`runOptimizeOnWorker`、`warmComputeWorker` |
| Optimize 协议已定 | `stage/src/optimize/protocol.ts`：`OptimizeJobPayload` / `Result` / `Progress` |
| Job runner 已存在 | `stage/src/optimize/job_runner.ts` |
| UI 面板已挂左栏 | `page/src/ui/layout/StructureOptimizePanel.tsx`、`LeftShellMode = "optimize"` |
| vsc-ext 可 spawn worker | `vsc-ext/src/webview/spawnComputeWorker.ts` |
| 测试半成品 | `stage/tests/optimize/job_runner.test.ts`、`placeholder_box_lbfgs.test.ts`、`core/tests/workload_host.test.ts` |

## Design

### 1. 唯一执行路径

- 产品 UI / RPC / 测试入口一律经 `runOptimizeOnWorker`（或等价 public API）。
- 主线程 **不得** 在 UI 线程同步跑完整 `relax` 循环（单元测试可注入 fake host）。
- Worker 侧：`installWorkloadHandler` + `job_runner` 调 `relax`；进度节流
  （`reportEvery`）发 `OptimizeProgress`。

### 2. 生命周期

| 事件 | 行为 |
|------|------|
| 打开 Optimize / Compute 左栏 | `warmComputeWorker()`（幂等） |
| Run | `run` + transfer list（坐标 / 键数组） |
| Cancel | `cancel` id；runner 在 `shouldCancel` 处退出；`cancelled: true` |
| Done | 主线程写回 frame（immutability：新 Frame），pipeline 走 `changeKind` 规则 |
| Error | 状态栏 error；不半写 frame |

### 3. 结果写回

- 成功：更新 primary trajectory HEAD 坐标（及可选 bonds / H）；dirty 标记与
  Save / commit 对话框沿用现有 `unsaved-scene-dialog`。
- 不绕过 `DataSourceModifier` 头；不直接 mutate 旧 Frame。

### 4. 宿主

- **page**：已有面板；确保 progress → `useStatusMessage`，cancel 按钮可打断。
- **vsc-ext**：Workbench / Open Page 若暴露 Optimize，必须用同一 `spawnComputeWorker`，
  不得复制 relax 逻辑。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `core/workload` WorkloadHost | reuse | 不重写 envelope |
| `stage/compute` runtime | reuse | 补齐 API 稳定性与测试，不新开第二 worker 体系 |
| `stage/optimize/relax.ts` | reuse | 算法留主线程模块，仅被 worker runner 调用 |
| Trajectory worker | pattern | spawn 模式对齐 `spawnTrajectoryWorker` / `new URL(..., import.meta.url)` |

## Files

| Path | Role |
|------|------|
| `core/src/workload/*` | 稳定 public surface；测 cancel / progress 相关 |
| `stage/src/compute/*` | worker + runtime 收口 |
| `stage/src/optimize/{job_runner,protocol,structure,index}.ts` | job 边界 |
| `page/src/ui/layout/StructureOptimizePanel.tsx` | UI 接线 |
| `vsc-ext/src/webview/spawnComputeWorker.ts` | 宿主 spawn |
| `stage/tests/optimize/*`、`core/tests/workload_host.test.ts` | 验收测试 |

## Tasks

- [x] 1. **Lock** public API：`runOptimizeOnWorker` / `warmComputeWorker` / protocol 导出面；废弃或删除主线程全量 relax 入口（测试注入除外）。
- [x] 2. **Wire** progress / cancel 端到端（worker → host → status bar / panel）。
- [x] 3. **Apply** 结果帧写回：immutability + pipeline 不绕过 DS；fixed indices / add H 行为与现 relax 一致。
- [x] 4. **Host** page 面板与（若有）vsc-ext 路径共用 spawn，无第二 relax 副本。
- [x] 5. **Test** workload cancel、optimize job_runner、placeholder box L-BFGS、runtime 注入 fake host。
- [x] 6. **Fix** writeback data loss（architect 2026-08-10）：box 与全部 atom 列在 optimize 后存活（克隆源 Frame、只覆写坐标、追加 H 行）；显式 `DataSource.replaceHeadFrame` 席位 — 不 reach-through、不静默 no-op、Frame 单一 owner。
- [x] 7. **Fix** worker cell + runner 契约：`Box.ortho`（非 cube）、填充 `boxOrigin`、triclinic 硬报错；damped 路径不原地 mutate 输入 frame；runner 校验 `optimizer`；core host cancel poller 只发一次 + dispose-during-ready race。
- [x] 8. **Move** `runOptimizeOnWorker` + progress 映射到 `optimize/worker_client.ts`（compute/ 只留通用 host 生命周期）；vsc-ext 两份 NormalModuleReplacementPlugin 块去重为共享 helper。

## Testing

- Unit：`core` workload host；`stage` job_runner + relax 数值回归。
- 无 e2e 车道；panel 逻辑用 mock host 测 progress 回调。

## Out of scope

- 把 RDF/MSD 等 analysis 迁入 worker（见 `workload-analysis-jobs`）。
- 新势函数 / 新优化器种类。
- Python 侧独立优化算法（Python 只经 RPC 触发前端 job，若需要另开 spec）。
