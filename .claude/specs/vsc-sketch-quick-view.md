---
slug: vsc-sketch-quick-view
status: approved
created: 2026-08-10
priority: P2
summary: Add VS Code Sketch Quick View (2D peek) parallel to stage-only Quick View.
---

# VS Code Sketch Quick View

## Summary

产品铁律：**Quick View 只保护 stage**（快 peek + deferred load）；Workbench
已有 Stage \| Sketch tabs，但 **没有 Sketch Quick View**。本 spec 增加轻量
2D Quick View：打开分子/草图相关文件时可用 sketch 引擎 peek，不加载 page
React 壳。

## Domain basis

| Fact | Evidence |
|------|----------|
| Stage QV | `vsc-ext/src/webview/controller.ts` + `attachQuickViewHost` |
| 无 sketch QV | notes 2026-08-03：`quickView` stage only; no sketch Quick View yet |
| Commands | `molvis.quickView`、`molvis.openSketch` |
| 协议 | `vsc-ext/src/protocol/` HostToWebview / WebviewToHost |
| 引擎边界 | Engine webview 不得依赖 `page/`；`rslib.webview` 配置注释 |
| Sketch 包 | `@molcrafts/molvis-sketch` `gui` flag |

## Design

### 1. 表面

| 表面 | 行为 |
|------|------|
| **Sketch Quick View** | 单 webview、sketch-only、deferred entry、stream/load 文件 |
| Stage Quick View | 不变 |
| Workbench | 仍是完整 Stage+Sketch；不替代 QV |

### 2. 命令与路由

- 新命令：`molvis.quickViewSketch`（标题 Sketch Quick View），**或**
  `molvis.quickView` 按扩展名分流（二选一，Tasks 锁定：**独立命令 + 资源管理器菜单项**，避免破坏 stage 默认）。
- 适合扩展名：与 sketch/化学 2D 相关的（如 `.mol`、`.sdf` 2D 路径、项目已支持的 sketch 格式）；**不确定则 open stage QV**，不猜错引擎。

### 3. Bridge

- 新增 `attachSketchQuickViewHost`（或泛化 host 的 sketch 子集），协议消息
  与 stage QV **共享可共享的 load/settings**，sketch 特有消息放 sketch 子集。
- **禁止** import `page`；只依赖 sketch + core。

### 4. 体验

- L0 shell → L1 `import()` sketch → load。
- 失败：webview 内错误边界（已有 `errorBoundary` 模式）。

## Reuse decision

| Candidate | Tag | Decision |
|-----------|-----|----------|
| `attachStageHost` / QV host | pattern | sketch 平行实现，不硬塞 stage app |
| Workbench sketch tab | reuse | 共享 load 协议片段，不共享 React page |
| `SketchComposer` gui | reuse | QV 可用 `gui: true` 或精简 chrome（产品选精简工具条） |

## Files

| Path | Role |
|------|------|
| `vsc-ext/package.json` | 命令/菜单 |
| `vsc-ext/src/extension/activate.ts` | 注册 |
| `vsc-ext/src/webview/*` | sketch QV entry + host |
| `vsc-ext/rslib.webview*.mts` | 新 entry 若需要 |
| `vsc-ext/tests/unit/extension/manifest.test.ts` | 命令存在 |
| `docs/interfaces/vscode/*` | 文档 |

## Tasks

1. **Add** command + menus + webview entry for sketch QV.
2. **Implement** host bridge (load/save/settings subset).
3. **Route** file types carefully; default stage QV unchanged.
4. **Test** manifest + unit host message shapes.
5. **Docs** quick-view.md 增加 Sketch 段。

## Testing

- Extension unit/manifest；无 full VS Code e2e 硬性要求。

## Out of scope

- 恢复 page 作为引擎 host。
- Sketch 自定义编辑器完整 ChemDraw 替换（Workbench 已覆盖重编辑）。
