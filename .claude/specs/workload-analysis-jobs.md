---
slug: workload-analysis-jobs
status: approved
created: 2026-08-10
priority: P0
summary: Run heavy Compute analyses on the shared workload/compute worker with cancel and progress.
depends_on:
  - optimize-worker-ship
---

# Workload-backed analysis jobs

## Summary

`core/workload` 与 `stage/compute` 已为 optimize 预留「将来 analysis」插槽，但
RDF / MSD / Cluster 等仍在主线程跑。本 spec 把 **重 compute 分析** 迁到同一
shared compute worker：统一 cancel、progress、warm-up，左栏 Compute 表单只
配置 + 展示结果。

## Domain basis

| Fact | Evidence |
|------|----------|
| Workload 注释写明 future analysis | `core/src/workload/index.ts`、`protocol.ts` |
| Compute protocol 已是 union 形状 | `stage/src/compute/protocol.ts`：`ComputeJob` / `Result` / `Progress` |
| Analysis 注册表来自 molrs catalog | `stage/src/analysis/registry.ts` → `molrsComputeCatalog()` |
| 左栏面板在 page | `page/src/ui/layout/analysis/*`（RDF、MSD、Generic…） |
| Trajectory 已有专用 worker 先例 | `stage` trajectory-worker + vsc-ext spawn |

## Design

### 1. Job 分型

扩展 `ComputeJob`（discriminated union），至少：

```ts
| { kind: "optimize"; payload: OptimizeJobPayload }
| { kind: "analysis"; id: string; /* catalog key */ params: …; frameSnapshot: … }
```

- `id` 对齐 catalog / registry 的 analysis key。
- **Frame 跨线程**：传 plain 坐标/列/box（与 optimize 相同纪律），不传 molrs
  handle；worker 内重建最小 Frame 或直接喂 molrs 绑定。

### 2. 哪些上 worker

| 上 worker | 暂留主线程 |
|-----------|------------|
| RDF、MSD、多帧 accumulate、Cluster 大 N | 纯表格式小结果、瞬时 scalar、已缓存结果 |
| 单帧但 N 大 / neighbor 构建 | 单元测试 mock |

规则：默认 **catalog 中 `input_kind` 含 accumulate / series / frameNeighbors**
的走 worker；面板可强制主线程仅用于测试 hook。

### 3. UX

- Run bar：Run / Cancel；progress 百分比或 phase 文案（status bar 同步）。
- Stale：参数或 frame 变了标 stale（沿用 compute-form 原则）。
- 结果回主线程后 **同一 ResultView / chart** 渲染；不因 worker 改 chart 库。

### 4. 与 optimize 共存

- **同一 worker 串行队列**（WorkloadHost 已 id-correlate）：一时刻一个 job，
  或明确文档化排队。禁止两个重 job 并行打爆 WASM 堆，除非 host 显式支持多
  worker（本 spec 不做多 worker）。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `WorkloadHost` | reuse | 扩展 job 类型，不新建第三套 messaging |
| `stage/analysis/*` 算法 | reuse | 抽「可在 worker 跑」的 pure 函数；面板只调 runtime |
| `dispatch.ts` / registry | generalize | worker 内用同一 registry 解析 id → runner |
| Trajectory worker | pattern | 仅参考 spawn；不把 analysis 塞进 trajectory worker |

## Files

| Path | Role |
|------|------|
| `stage/src/compute/protocol.ts` | union 扩展 |
| `stage/src/compute/worker.ts` | 分发 analysis |
| `stage/src/compute/runtime.ts` | `runAnalysisOnWorker` |
| `stage/src/analysis/*` | 可序列化入参 / 出参边界 |
| `page/src/ui/layout/analysis/*` | 接线 cancel/progress |
| `stage/tests/…`、`core/tests/…` | 假 worker + 真 RDF 小样本 |

## Tasks

1. **Define** analysis job/result/progress wire shapes（plain data only）。
2. **Dispatch** worker-side by catalog id；至少 RDF + 一个 accumulate 类。
3. **API** `runAnalysisOnWorker` + 与 optimize 串行队列行为文档/测试。
4. **Wire** RdfPanel（及 Generic 若适用）Run/Cancel/progress。
5. **Test** cancel mid-RDF；小分子 RDF 结果与主线程参考一致（同 fixture）。

## Testing

- 数值：固定小轨迹 RDF 主线程 vs worker 数组近似相等。
- Cancel：runtime 测试。
- 不引入 e2e browser 车道。

## Out of scope

- 新 analysis 算法 / 新 chart 类型。
- 多 worker 并行池。
- Rings first-class 面板（`compute-partial-first-class`）。
