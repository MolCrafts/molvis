---
title: one-viewer-surface-03-quicklook-surface — Quick look 改用 page 外壳，chrome 关闭
status: approved
created: 2026-09-17
slug: one-viewer-surface-03-quicklook-surface
chain: one-viewer-surface (link 3 of 5)
scope_layer: vsc-ext (+ one callback seam in page)
---

# one-viewer-surface-03-quicklook-surface — Quick look 改用 page 外壳，chrome 关闭

## Summary

Quick look 面板改用 page bundle，以 `surface: "canvas"` 挂载。**本环之后功能即完整**：画布上的「Show controls」把 chrome 打开，不销毁面板、不重读文件、不重新解析。

**零新协议符号。** 这一点是本环切法的关键，也是我先前切错的地方：link 01 的 `mountMolvisApp` 在宿主未提供 `onSurfaceChange` 时会自行 `store.patch({ surface })`（`page/src/lib/mount.tsx:166-168`），所以**按钮不需要任何宿主往返就能工作**。`setSurface` / `surfaceChanged` 的往返只有 `molvis.openInPage`（从宿主侧发起提升）才真正需要，那属于 link 04。先前把往返放在前面，才逼出了「`openInPage` 的新分支在迁移前没有生产者」的死代码。顺序反过来，每个检查点都没有未被消费的符号。

本环**不改** `molvis.openInPage`：它今天的 dispose + 新建 Page 行为仍然正确，只是不再是唯一的提升途径。

## Design

### 1. 首帧必须直接是 canvas（否则会闪一下全 chrome）

`vsc-ext/src/page/bootstrap.tsx:42` 今天把 `surface: "full"` 写死。`init.surface`（link 02）**到不了首帧**：它要等 `ready` → 宿主 → `init`，而 `postPageReady` 是在 `onAppChange` 里发的，即 `app.start()` 之后。照搬现状迁移，Quick look 会先画出完整 chrome 再塌回去——这既违反 link 02 写在 `protocol/messages.ts` 上的契约（「搭 `init` 正是为了不先画全 chrome 再纠正」），也让本环「打开即无 chrome」的验收无法成立。

机制已经存在且闲置：`page/src/lib/mount-opts.ts:144` 的 `readMountOptsFromHost()` 读 `window.__MOLVIS_VSCODE_INIT__.mount`，而 **vsc-ext 全树从未注入过这个全局**（已实测）。因此：

- `getPageHtml(webview, extensionUri, mount?)` 在 HTML 里注入 `window.__MOLVIS_VSCODE_INIT__ = { mount }`。
- `bootstrapPage` 的 surface 取自 `readMountOptsFromHost().surface ?? "full"`，不再写死。

于是 surface 恰好有**两个载体，各司其职**：注入 = 启动时的真值，`init.surface` = 送达后的确认。`hostSurfaceOf` 仍是消息侧唯一的读取者。本环不新增第三条。

### 2. capability registry 进 bootstrap，生命周期绑在 app 上

`previewPanel` 的结构大纲由 `createCapabilityRegistry` 发布，而它**只在 `webview/controller.ts:50` 被创建**；`bootstrap.tsx` 从未创建过。不搬就会静默弄丢侧边栏的 Stage 大纲。

**但不能照搬 `controller.ts` 的形状。** `controller.ts` 在文档生命周期内只有一个 `app`，所以它能在 `beforeunload` 里 dispose。`bootstrapPage` 不是：app 由 `onAppChange` 送来，并且在页面 reload viewer 时**会被替换**（先 `null` 再新实例）。`createCapabilityRegistry({ app, host })` 捕获的是某一个实例，其 outline capability 订阅了 `app.events.on("frame-rendered")`。只在 `beforeunload` dispose 会把监听器泄漏在死掉的 app 上，而新 app 没有大纲。

因此 registry 的创建与 dispose 放进 `onAppChange`，与既有的 `bridge?.dispose(); bridge = null;` 同形。

### 3. 大纲的反向路由——一个既有 bug，本环修掉

实测确认（非推测）：`StructureOutlineProvider` 的选择回调（`activate.ts:66-68`）只发给 `activeStage`，而 `activeStage` **只在 `openStage` 里赋值**（`:138`）。Quick look 在 `:304` 喂大纲时把 `previewPanel.ts:87` 传来的 **webview 参数丢掉了**（回调只接 `payload`）。

所以今天的真实行为是：在 Quick look 打开文件 → 侧边栏出现大纲 → 点条目 → 没开 Stage 面板时 `if (!activeStage) return`，**静默无反应**；开着 Stage 且是别的文件时，选中的是错的面板。

这是**先于本环存在的 bug**，不是迁移引入的。但本环把 Quick look 换到新表面，正好经过这条线，按铁律不得放过：让 `StructureOutlineProvider` 记住发布该大纲的 webview，`selectAtoms` 发回那一个。缝已经在了（`previewPanel.ts:87` 的第二参数），只是被丢弃。

### 4. 拖放平价——不得静默丢功能

实测确认：`attachStageHost` 的 `enableDrop` 默认为 `true`（`:97`），其 drop 处理器读 `text/uri-list` 并发 `dropUri`（`:364-374`）。Quick look 今天经 `attachQuickViewHost` 拿到这条路径，**从资源管理器拖文件是可用的**。而 `bootstrap.tsx:53` 用 `enableDrop: false`（拖放 UI 与未保存提示归 page 外壳），page 自己的处理器只读 `dataTransfer.items` / `.files`，全树只有 `attachStageHost.ts:364` 认识 `text/uri-list`。

直接迁移 = Quick look 从此拖不进文件。page 外壳**自己修不了**：webview 读不到工作区文件，必须宿主代读。

修法是最小的一条缝，与 link 01 的 `onSurfaceChange` 同形：`MountHostOpts` 增可选 `onDropUris?: (uris: string[]) => boolean`，page 的 drop 处理器在读 items/files **之前**先取 `text/uri-list`，有内容就交给它；返回 `true` 表示宿主已接管，page 不再自行处理（避免同一次拖放被加载两遍）。`bootstrap.tsx` 把它接到 `host.postMessage({ type: "dropUri", … })`。`enableDrop: false` 保持不变——仍然只有一个 drop 处理器。

这是本环唯一触碰 `page/` 的地方，且不触碰不行：不加就是静默回归。

### 5. previewPanel 改用 page bundle

`getPreviewHtml` → `getPageHtml(panel.webview, context.extensionUri, { surface: "canvas" })`。其余不变——它与 `pagePanel.ts` 只差一个 `structureOutline` case，而那个 case 由 §2 保住。

`stagePanel.ts` / `editorProvider.ts` / `binaryEditorProvider.ts` **本环不迁移**，继续用 `getPreviewHtml` 与 stage bundle，因此 `getPreviewHtml`、`webview/index.ts`、`controller.ts`、`attachQuickViewHost.ts` 全部仍是活的，不产生孤儿。

### 6. 首帧体积——记名，不欠决定

Quick look 的首帧从 ~8.2 MB 的 stage chunk 变成 ~10.6 MB 的 page chunk（+29%），发生在本仓最常用的表面上。**不欠 lazy-load 决定**：`vsc-ext/src/page/index.tsx:43-51` 已经把外壳放在两帧之后的动态 import 后面，overlay 先画，`tests/unit/extension/webviewBundle.test.ts:65-73` 把入口钉在 64 KB 以下，那道闸会咬。另记：`previewPanel.ts:44` 的 `retainContextWhenHidden: true` 意味着每个隐藏的 Quick look 标签现在钉住 10.6 MB。待 `stagePanel` 与两个自定义编辑器迁移、stage chunk 退役后，这笔开销被抵消。

## Files to create or modify

- `vsc-ext/src/extension/panels/html.ts`（`getPageHtml` 注入 mount，bump `WEBVIEW_ASSET_REV`）
- `vsc-ext/src/extension/panels/previewPanel.ts`
- `vsc-ext/src/page/bootstrap.tsx`
- `vsc-ext/src/extension/activate.ts`（大纲反向路由）
- `vsc-ext/src/extension/panels/structureOutline.ts`
- `page/src/lib/mount.tsx`（`MountHostOpts.onDropUris`）
- `page/src/MolvisWrapper.tsx`（drop 处理器的 uri-list 分支）
- `vsc-ext/tests/unit/extension/webviewBundle.test.ts`（注入断言）
- `page/tests/lib/mount.drop.test.ts`（新）

## Tasks

- [ ] Write a failing unit test for the uri-list drop branch (page/tests/lib/mount.drop.test.ts)
- [ ] Add MountHostOpts.onDropUris and the text/uri-list branch in MolvisWrapper's drop handler
- [ ] Inject window.__MOLVIS_VSCODE_INIT__.mount from getPageHtml and read the boot surface in bootstrapPage instead of the hard-coded "full"
- [ ] Create and dispose the capability registry inside bootstrap.tsx onAppChange, and wire onDropUris to a dropUri post
- [ ] Route outline selectAtoms back to the webview that published the outline
- [ ] Serve getPageHtml with surface "canvas" from previewPanel.ts and bump WEBVIEW_ASSET_REV
- [ ] Verify live in VS Code: Quick look opens with no chrome and no full-chrome flash, Show controls opens the UI without reloading, the outline lists and selects, Explorer drag still loads a file
- [ ] Run full check + test suite

## Testing strategy

- `page/tests/lib/mount.drop.test.ts`：`onDropUris` 在 `text/uri-list` 存在时被调用一次且拿到 uri 列表；返回 `true` 时 page 不再走 items/files 路径（防重复加载）；无 uri-list 时不被调用。这是本环唯一能在单测里咬人的行为。
- `vsc-ext/tests/unit/extension/webviewBundle.test.ts`：`getPageHtml` 传入 mount 时产出的 HTML 含 `__MOLVIS_VSCODE_INIT__` 且含 `"canvas"`；不传时不含该全局（否则注入会悄悄变成必选）。
- 不可单测的部分明说：面板与 `bootstrap.tsx` 导入 `vscode` 值或 stage/page 运行时，node/mocha 无法加载。守卫是 typecheck、上述两组单测、以及实机验证。
- **实机验证是唯一能证明「提升不重载」与「首帧无闪」的闸**，Tasks 第 7 项逐条列明，必须逐条核对而非整体感觉。
- 不新增 `regressions/` 脚本（lane 条文矛盾待裁定，见 `notes.md`）。

## Out of scope

- `setSurface` / `surfaceChanged` 往返、`molvis.openInPage` 改写、面板标题归属、`activePage` 跟踪——link 04。其中三项是本环 architect 评审发现的真实问题，必须由 04 一并处理，不得遗漏：
  - `previewPanel.ts:63,90` 在每次 `dirtyStateChanged` 时重设 `panel.title`，外部写标题会被静默回滚——标题必须由面板自己拥有。
  - 提升后面板仍只记在 `activeQuickView`，`molvis.openPage` 会再开第二个 page webview，绕过「同文件不重载」的守卫。
  - `molvis.openInPage` 的 `when`（`package.json:398`、`:309`）在提升后仍然可见，因为 viewType 不变。
- 迁移 `stagePanel.ts` / `editorProvider.ts` / `binaryEditorProvider.ts`，退役 `getPreviewHtml` / `webview/index.ts` / `controller.ts` / `attachQuickViewHost.ts`——link 05。
- `molvis.defaultViewer` 语义与四份文档、`notes.md` 中「提升必然重载」一节的改写——link 05。
- `page-host-init-single-path`（已立 spec，未实现）。本环把 Quick look 这个最高流量的表面放到了那条分叉的送达路径上，建议在 link 04 之前实现它。
- `enableCapability` / `disableCapability` 至今没有任何宿主生产者（`messages.ts:126-127`）——记名，本环不动。
