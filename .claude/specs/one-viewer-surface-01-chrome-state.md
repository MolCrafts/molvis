---
title: one-viewer-surface-01-chrome-state — 单一渲染树 + chrome 活状态
status: approved
created: 2026-09-17
slug: one-viewer-surface-01-chrome-state
chain: one-viewer-surface (link 1 of 7)
scope_layer: page
---

# one-viewer-surface-01-chrome-state — 单一渲染树 + chrome 活状态

## Summary

把 `page/` 的 surface/chrome 从「挂载时读一次的静态配置」变成「宿主可在运行时改写的活状态」，并且保证改写**不会拆掉 Babylon**。两件事必须同时落地：

1. **删掉 `App.tsx:465` 的 `canvasOnly` 提前返回**，把它并回唯一那棵渲染树。今天 `MolvisWrapper` 在 `App.tsx:483` 与 `:567` 各挂载一次，祖先路径不同；React 按位置对账，surface 翻转会卸载一棵、挂载另一棵，WebGL 上下文与整个 scene 被销毁重建——这正是整条七链要消灭的东西。同一文件 `:186-188` 已为平行的 `uiHidden` 轴写明正确做法：「The canvas panel stays mounted so the engine is never torn down」。
2. 新增一个 React 无关的 `MountOptsStore`，宿主经 `MountedApp.setOpts` 写入，React 侧用 `useSyncExternalStore` 订阅。

**行为变化（不掩饰）：这不是对现有调用方零行为变化的改动。** `surface: "canvas"` 的宿主从今往后拿到完整 shell 树（provider 链、对话框宿主、命令面板容器都会挂载），只是每个可见区域被 `chrome.*` / `canvasOnly` 关掉；渲染出的 DOM 与今天那个极简 `<section>` 不同。保持不变的是：画布本身、`aria-label="MolVis molecular viewer"` 的 section、以及 canvas surface 下「没有任何 chrome 可见」这一可观察结果。

**铁律点名（两项，均须在交付摘要中复述）：**

- **`page/src/MolvisWrapper.tsx:544-577` 与 `vsc-ext/src/webview/attachStageHost.ts:147-160` 对同一个 `Molvis` 重复应用 `init`/`applySettings`**，且 origin 规则不对称（前者卡 `event.origin !== window.location.origin`，后者不卡）。在 VS Code webview 中该 origin 条件成立，因此 page 面板**很可能今天就在双重应用 config/settings**。跨 `page` 与 `vsc-ext` 两包，不是本环能就地修的局部腐化，按铁律第 2 条 **route**：立 `page-host-init-single-path` 为独立 spec。本环不碰 `MolvisWrapper.tsx`。
- **`.claude/notes/package-architecture.md:78-86` 的 `regressions/` 契约已过期**：条文写「import built `dist` output only」，但 `regressions/traj-ingest-04-range.ts:9-10` 同时 import `../stage/src/io/formats.ts` 与 `../vsc-ext/src/extension/loading/molecularLoadIntent.ts`（皆为 `src`），且 31 个脚本中有 21 个用 `readFileSync` 断言源码文本。本环 scope 是 `page/`，lane 在仓库根，**不在此修**；route 到 `/mol:note` 修订条文。

## Design

### 1. 统一渲染树（消除双 `MolvisWrapper`）

删除 `App.tsx:465-497` 的提前返回及其内部的 `MolvisWrapper`（`:483`）。此后 `App` 只有一棵树，唯一的 `MolvisWrapper` 在 `:567`（`ResizablePanel id="canvas"` 内），`key={viewerGeneration}` 语义不变——只有显式 reload 才重建引擎。

`canvasOnly`（`App.tsx:123-128`，由 `resolveChrome` 全假推出）**保留**，但从「控制流开关」降级为「区域守卫」，与 `uiHidden` 同构。已由 `chrome.*` 守卫的区域不动（`:330` `:331` `:363` `:520`）。需要处置的：

- `:518` `WeChatOpenBrowserBanner` → `!uiHidden && !canvasOnly`
- `:697` `WorkbenchBottomPanel` → **`{!canvasOnly && <WorkbenchBottomPanel app={app} hidden={uiHidden} />}`**。**不可**写成 `hidden={uiHidden || canvasOnly}`：那样组件仍然挂载，而 `WorkbenchBottomPanel.tsx:85` 要等 `usePluginBottomPanels()` 订阅了插件贡献存储、两个 effect 跑完之后才返回 `null`——canvas 嵌入方会凭空多出一个全局订阅与状态抖动，而 ac-003 只断言 DOM 不可见，闸口对此结构性失明。四处守卫因此形式统一。
- `:716` `KeyboardShortcutsDialog` → `!canvasOnly && <KeyboardShortcutsDialog …>`。**在渲染点拦，不在 `:368-388` 的 keydown effect 里拦**：该 effect 依赖数组为 `[]`，闭包住 `canvasOnly` 会在 surface 翻转后读到陈旧值；而且在 handler 里拦会让 `shortcutsOpen` 对未来任何非键盘路径仍然可达。effect 一行不改。
- `:658` / `:684` 两个 `ViewerSidePanel` 不动：外层 `chrome.leftSidebar` / `chrome.rightSidebar` 守卫已足够，`canvasOnly` 要求二者为假。

**两棵树的差异（逐条核对，统一后以主树为准）：**

| 项 | `canvasOnly` 树（将删） | 主树（保留） |
|---|---|---|
| provider 链 | `ErrorBoundary → BackendConnectionProvider → FormatPickerProvider → BondMappingPickerProvider` | 同上，**多一层 `LeftShellProvider`** |
| `StateSyncDialog` | 在 `<section>` 之外 | 在 `<section>` 之内 |
| `<section>` | 无 `ref`，`relative h-full w-full bg-background overflow-hidden` | 带 `ref={rootRef}`，另有 `flex flex-col text-foreground safe-area-shell` |
| canvas 包裹 | `<section>` 直接子节点 | `ResizablePanelGroup → ResizablePanel#canvas → div.flex-1.bg-canvas` |

`BackendConnectionProvider` 的 props 与位置两棵树**完全相同**（已核对）。`LeftShellProvider` 在 canvas surface 下变为活跃——无害，其唯一动作 `openLeftAdvancedPanel` 只写 `computeInlineOpen`，而 `chrome.leftSidebar` 为假时左栏不渲染。`StateSyncDialog` 今天在 canvas surface 下已经渲染（`:486-492`），统一后只是嵌套位置变化，它是 portal 对话框，对可见性无影响。`rootRef` / `useIsNarrow` 在 canvas surface 下也会挂载，多一个 `ResizeObserver`，不产生可见区域。

**已知债（点名，不在本环修）：** `canvasOnly` 是五个无关 flag 的 AND，是一个 god-predicate——WeChat banner 与底部面板是否渲染，现在取决于 `chrome.timeline`。降级为守卫是真实改进，但谓词本身仍然低内聚；干净的修法（给这些区域各自的 flag）被本环对 `mount-opts.ts` 的冻结挡住。目的地：link 07。

### 2. `MountOptsStore`（`page/src/lib/mount-opts-store.ts`，new）

React 无关的小状态容器，一个职责：持有当前 `MountOpts` 并广播变更。

- 构造：`new MountOptsStore(initial: MountOpts)`（无工厂函数）。
- 成员一律为**绑定的箭头实例属性**而非原型方法——`useSyncExternalStore(store.subscribe, store.get)` 会脱离接收者调用，原型方法此时 `this === undefined`，首次渲染即抛错：
  - `get = (): MountOpts` —— 当前不可变快照；**未变更时引用必须稳定**，否则 `useSyncExternalStore` 无限重渲染。
  - `subscribe = (listener: () => void): () => void`
  - `patch = (next: Partial<MountOpts>): void` —— 生成**新对象**（CLAUDE.md 不可变性铁律），仅在结果与上一快照不等值时通知。
  - `close = (): void` —— 清空监听者；`close` 之后的 `patch` 是**有文档记录的 no-op**。
- 不持有 `onSurfaceChange`、不持有 React、不 import DOM，可在无 DOM 下单测。

### 3. `MountOptsRoot`（`page/src/lib/MountOptsRoot.tsx`，new）

纯 React 适配层，**不含策略**：

```
MountOptsRoot({ store, children }) =>
  <MountOptsProvider value={useSyncExternalStore(store.subscribe, store.get)}>
    {children}
  </MountOptsProvider>
```

无 `useMemo`、不注入任何默认回调、不知道 surface 语义。拆两个模块是承重的：store 可在无 DOM 环境单测，React 依赖被限制在 `.tsx` 内（`package-architecture.md:33`）。`mount.tsx:148` 是树内唯一的 `MountOptsProvider`，`index.tsx:44` 与 `vsc-ext/src/page/bootstrap.tsx:44` 都经 `mountMolvisApp`，替换后仍然只有一个家，不存在所有权分裂。

### 4. `onSurfaceChange` 放在 `MountHostOpts`，默认在 `mountMolvisApp` 里组合

`MountOpts` 必须保持可 JSON 化：`readMountOptsFromUrl`（`mount-opts.ts:176-188`）由 `URLSearchParams` 构造它，`readMountOptsFromHost`（`:144-167`）从不可信全局里展开它；挂函数上去会让这两个 parser 不再是全函数。因此 `onSurfaceChange` 加在 `MountHostOpts`（`mount.tsx:10-36`），与 `onAppChange` / `useShadowDOM` / `cssUrls` 同列。**`mount-opts.ts` 本环完全不改**，`page/tests/mount-opts.test.ts` 保持原样作为未回归的证据。

```
const store = new MountOptsStore(opts);
const onSurfaceChange =
  hostOpts.onSurfaceChange ?? ((s: MolvisSurface) => store.patch({ surface: s }));
root.render(
  <MountOptsRoot store={store}>
    … <App onAppChange={hostOpts.onAppChange} onSurfaceChange={onSurfaceChange} /> …
  </MountOptsRoot>
);
```

`onSurfaceChange` 像 `onAppChange`（`mount.tsx:151`）一样作为 prop 下传，不新增 context。策略（宿主缺席时谁拥有 surface 位）只在这一处合成。

`MountedApp` 新增 `setOpts(next: Partial<MountOpts>): void` → `store.patch(next)`。`dispose()`（`mount.tsx:161-173`）**先 `root.unmount()`，后 `store.close()`**（次序写死，否则订阅者可能在拆卸中途读到已关闭的 store），使卸载后的 `setOpts` 成为 no-op 而不是向死树广播。`vsc-ext/src/page/bootstrap.tsx:44` 今天丢弃返回值，方向是 host → page，纯增量，本环不改该文件。

**宿主往返义务：** 宿主一旦自己提供 `onSurfaceChange`，就接管了真值——它**必须**在处理完意图后调用 `MountedApp.setOpts({ surface })` 写回，否则按钮是死的。此义务写进 `MountHostOpts.onSurfaceChange` 的 JSDoc。真值在包外，link 03 的 `vsc-ext` 测试是写回的证明；本环补一条测试覆盖宿主分支被调用这一半（见 Testing）。store 与宿主不会同时写渲染值：无宿主时 store 拥有，有宿主时宿主拥有。

### 5. canvas surface 下的复原入口

`ExitFullscreenAction`（`page/src/components/viewer/ExitFullscreenAction.tsx`）在本环出现第二个调用点，几何字节相同（`absolute right-2 top-2`），符合「第二次使用才提取」（`design-preferences.md:57-58`）——两个调用点都在本环之内。提取为 `CanvasOverlayAction`（`page/src/components/viewer/CanvasOverlayAction.tsx`，new；旧文件删除），props `{ icon, label, onClick }`，几何仍硬编码，**不加 `corner` prop**（没有第二个角）。命名取其**职责**（叠在画布上的动作），不编码位置。两个调用点：

- `App.tsx:572-576`：`uiHidden` 时的「Exit fullscreen」（`Minimize`），行为不变。
- canvas 区域内：`canvasOnly && !uiHidden && onSurfaceChange && <CanvasOverlayAction icon={<PanelsTopLeft/>} label="Show controls" onClick={() => onSurfaceChange("full")} />`。`onSurfaceChange` 缺席时不渲染——不做死按钮。两者互斥（canvas surface 下 `uiHidden` 无人能置真，顶栏不可见）。

### 6. 测试缝

`AppProps.canvas?: ReactNode`。渲染点写 `canvas ?? <MolvisWrapper key={viewerGeneration} onMount={setApp} />`——**不能**写成解构默认值，因为 `viewerGeneration`（`:177`）与 `setApp`（`:132`）在函数体内声明。JSDoc 标明这是测试缝、无生产调用方；注入画布时 `reloadViewer` 成为 no-op，对假节点无碍。

这是显式依赖注入缝（`design-preferences.md:59-61`）。树内 `page/tests` 与 `stage/tests` **没有任何** `rstest.mock` / `vi.mock` 用法——显式 DI 是本仓唯一的伪造机制。没有它就必须启动 Babylon + WebGL 才能证明 ac-002，那样单测就要靠整图，设计即未完成。

### 不做 `regressions/` 脚本

一个去 grep `App.tsx` 标识符的脚本断言的是实现文本——真回归只要字符串留存就能通过，无关重命名却会变红，按 CLAUDE.md「每道闸必须被证明会咬人」不是闸；而且它与本环三个单测完全重叠。`optimize-staging-05-panel.ts` 那种跨包重复字面量的场景在此不存在（本环 `page/` 单包）。交付闸是 `npm run test:page`。

### Reuse decision

- `reuse` `resolveChrome` / `MolvisSurface` / `MolvisChromeFlags`（`mount-opts.ts:9/16/90`）—— 原样使用，不新增 flag 类型、不新增 preset、不改 `mount-opts.ts`。
- `reuse` `MountOptsProvider` / `useMountOpts`（`mount-opts.ts:78/80`）—— 只换数据源。
- `reuse` `useSyncExternalStore`（React 19 内置）—— 不自造订阅 hook。
- `generalize` `ExitFullscreenAction` → `CanvasOverlayAction`：本环创造第二个调用点，把既有实现提升为同时服务两个调用方；不并行实现第二个按钮组件。
- `reuse` `ViewerIconAction` —— `CanvasOverlayAction` 继续在它之上组合。
- `new` `MountOptsStore` / `MountOptsRoot` —— 树中无任何「可运行时改写并广播 MountOpts」的载体；`MountOptsContext` 只是静态值的传递管道。

## Files to create or modify

- `page/src/lib/mount-opts-store.ts` (new)
- `page/src/lib/MountOptsRoot.tsx` (new)
- `page/src/components/viewer/CanvasOverlayAction.tsx` (new)
- `page/src/components/viewer/ExitFullscreenAction.tsx` (deleted)
- `page/src/lib/mount.tsx`
- `page/src/App.tsx`
- `page/tests/lib/mount-opts-store.test.ts` (new)
- `page/tests/lib/MountOptsRoot.test.tsx` (new)
- `page/tests/App.test.tsx` (new)

不改动：`page/src/lib/mount-opts.ts`、`page/tests/mount-opts.test.ts`、`vsc-ext/src/page/bootstrap.tsx`、`page/src/index.tsx`、`page/src/MolvisWrapper.tsx`。

## Tasks

- [ ] Write failing unit tests for MountOptsStore (page/tests/lib/mount-opts-store.test.ts)
- [ ] Implement MountOptsStore in page/src/lib/mount-opts-store.ts (bound arrow members, immutable snapshot, close)
- [ ] Write failing unit tests for MountOptsRoot (page/tests/lib/MountOptsRoot.test.tsx)
- [ ] Implement MountOptsRoot in page/src/lib/MountOptsRoot.tsx (useSyncExternalStore + MountOptsProvider, no policy)
- [ ] Add the AppProps.canvas + onSurfaceChange injection seams to page/src/App.tsx (render site `canvas ?? <MolvisWrapper …>`, JSDoc marking canvas a test seam)
- [ ] Write failing unit tests for App surface continuity (page/tests/App.test.tsx)
- [ ] Unify the canvasOnly branch into the single App tree in page/src/App.tsx (delete the `:465` early return and the `:483` duplicate MolvisWrapper; guard `:518`, `:697` by mount, `:716` at the render site)
- [ ] Generalize ExitFullscreenAction into page/src/components/viewer/CanvasOverlayAction.tsx and use it at both call sites
- [ ] Wire MountOptsStore through mountMolvisApp in page/src/lib/mount.tsx (MountHostOpts.onSurfaceChange + round-trip JSDoc, default composition, MountedApp.setOpts, dispose unmount-then-close)
- [ ] Record the routed debt: file page-host-init-single-path and the /mol:note for package-architecture.md:78-86
- [ ] Run full check + test suite

任务 5 在任务 6 之前：测试需要 `canvas` 注入缝才能编译。任务 6 的测试对尚未统一的树是红的，任务 7 转绿——这是 RED→GREEN 的正常一对，其余每个检查点分支尖端皆绿。

## Testing strategy

单测 only，浏览器模式 rstest，`npm run test:page` 自身必须充分（CLAUDE.md 铁律）；路径镜像源码。

- `page/tests/lib/mount-opts-store.test.ts` → `TestMountOptsStore`（无 DOM 依赖）
  - happy：`patch({ surface: "full" })` 后 `get()` 返回含新 surface 的新对象；监听者被调用一次。
  - edge：无变更时连续两次 `get()` 返回**同一引用**（`useSyncExternalStore` 无限重渲染防线）。
  - edge：解除订阅后不再收到通知。
  - edge：`close()` 后 `patch` 不通知、`get()` 仍返回最后快照。
  - edge：`const { get, subscribe } = store` 解构后调用不抛 `TypeError`。
- `page/tests/lib/MountOptsRoot.test.tsx` → `TestMountOptsRoot`（`page/tests/react_harness.ts` 的 `mountComponent`，探针组件调 `useMountOpts()`）
  - happy：初始渲染读到 store 初值。
  - happy：`act(() => store.patch({ surface: "full" }))` 后探针文本更新。
  - edge：`MountOptsRoot` 不接收也不合成任何回调 prop——无宿主回调时探针仍正常渲染（策略不在此模块的证据）。
- `page/tests/App.test.tsx` → `TestApp`（注入 `canvas={<div data-testid="canvas-probe" />}`，不启动 Babylon；不提供 `wsUrl`，`useBackendConnection.tsx:76-80` 在无 `wsUrl` 时短路为 `idle`，不发起网络）
  - **核心 gate**：记下 `canvas-probe` 的 DOM 节点引用 → `store.patch({ surface: "full" })` → 断言 `probe === 同一节点 && probe.isConnected`，且顶栏已出现。提前返回一旦回归，`LeftShellProvider` 会被换出 provider 链，整棵子树卸载，该节点必被替换，测试必红。
  - happy（canvas surface）：查不到 `ViewerToolbar`、左右 `ViewerSidePanel`、`WorkbenchBottomPanel` 与 WeChat banner；能查到 `label="Show controls"` 的动作按钮。
  - edge：canvas surface 下按 `"?"` 不打开 `KeyboardShortcutsDialog`；按 `Escape` 不抛错。
  - edge：不传 `onSurfaceChange` 时 canvas surface 不渲染 "Show controls"（不做死按钮）。
  - edge（宿主分支）：传入自定义 `onSurfaceChange`，点击 "Show controls" 后该回调被调用一次且参数为 `"full"`，同时 `store.get().surface` **保持 `"canvas"`**（真值已交给宿主，本包不自行翻转）。
  - **约束（写进测试文件头，不得放宽）**：本文件只断言 DOM 存在性与节点同一性。`App` 静态 import `@/plugins`，其 barrel 导出模块级单例 store（`analysisStore` / `dialogStore` / `panelStore` / `toolbarActionStore`），`bottom_panel_host.ts` 另持模块全局 `lastRequest`；对插件 store 的任何断言都会让本套件顺序相关。
- 交付闸：`npm run test:page` 零失败（基线 `5f4421d` = 214/214）+ 全量 pre-commit。

## Out of scope

- 不改 `page/src/lib/mount-opts.ts` 与 `page/tests/mount-opts.test.ts`。
- 不碰 `App.tsx:189` 的 `uiHidden` 轴。
- 不新增 chrome flag、不新增 surface preset、不做每面板的运行时切换 UI。
- 不改 `vsc-ext`：宿主侧 `onSurfaceChange` + `setOpts` 往返由 link 03 落地并测试。
- 不修 `MolvisWrapper.tsx:544` 的重复 apply 与 origin 不对称——route 到独立 spec `page-host-init-single-path`。
- 不修 `package-architecture.md:78-86` 的过期条文——route 到 `/mol:note`。
- `canvasOnly` god-predicate 的分解——目的地 link 07。
