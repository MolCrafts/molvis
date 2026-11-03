---
title: one-viewer-surface-02-surface-message — host→webview surface 声明
status: approved
created: 2026-09-17
slug: one-viewer-surface-02-surface-message
chain: one-viewer-surface (link 2 of 7)
scope_layer: vsc-ext
---

# one-viewer-surface-02-surface-message — host→webview surface 声明

## Summary

让 VS Code 扩展宿主能在 `init` 消息里声明 page webview 应呈现哪个 surface（`"full"` / `"canvas"`），并把该声明送达 page shell。方向是**单向 host → webview**：本环之后宿主可以推一个 surface；用户在 page 内主动切换并回报宿主（`surfaceChanged`）属于 link 03，本环**不预埋任何无消费者的 wire 成员**。

实现方式是在 `attachStageHost` 上开一个**非占用的前置观察缝** `onMessageSeen`。必须如此的原因：`handleCore` 在 `attachStageHost.ts:147-160` 已 `case "init"` 并 `return true`，而 `handleMessage`（`:306-309`）先跑 `handleCore`——所以 `onExtraMessage` 结构上**永远看不到** `init.surface`。备选的 `listenWindow: false`（让 page 自建 window 监听）被否决：`attachStageHost.ts:311-317` 是「window 消息 → 过滤 → 派发」这条链路的唯一所有者，`listenWindow` 今天在树里没有任何生产者；让 page 成为第一个使用者，就是让它重造一份过滤与派发次序，并靠约定与 Quick look 保持一致——此后该监听器内部任何改动（origin 校验、去重、次序）都只作用于 Quick look 而静默漏掉 page。

**不需要新的允许表。** `"init"` 本来就在 `QUICK_VIEW_HOST_MESSAGE_TYPES`（`messages.ts:176`）里。既然 surface 搭 `init` 的车而不是新开一条 `setSurface` 消息，`attachStageHost` 的默认 `isHostMessage` 已经放行它——一个内容与 Quick look 集合逐字相同的 `PAGE_HOST_MESSAGE_TYPES` 只是纯别名，其「排序后与 Quick look 相等」的测试是同义反复、永远不会红，属于投机性泛化，本环不做。

**铁律点名（两项，须在交付摘要中复述）：**

1. **`page/src/MolvisWrapper.tsx:544-577` 与 `vsc-ext/src/webview/attachStageHost.ts:147-160` 对同一个 `Molvis` 重复应用 `init`/`applySettings`**，且 origin 规则不对称；VS Code webview 中 `event.origin === window.location.origin` 成立，故 page 面板**很可能今天就在双重应用 config/settings**。跨包，非局部，按铁律第 2 条 route：`page-host-init-single-path` 必须**先立成真实 spec**，本环方可进入实现。本环新增的 `init.surface` 对该路径是**惰性的**——那个处理器只读 `payload.config` / `payload.settings`（`MolvisWrapper.tsx:565-575`），新字段结构上不可能被双重应用；这降低本环风险，但不消解上面的债。
2. **`.claude/notes/package-architecture.md:81-83` 的 `regressions/` 契约与 lane 实况矛盾**：条文写「import built `dist` output only」，而 `regressions/traj-ingest-04-range.ts:9-10` 同时 import `../stage/src/io/formats.ts` 与 `../vsc-ext/src/extension/loading/molecularLoadIntent.ts`（皆 `src`）。route 到 `/mol:note` 修订条文。

## Design

### 硬前置

- **link 01 必须先落地**，因为 `bootstrap.tsx` 要调用它引入的 `MountedApp.setOpts({ surface })`。本环**不要求** link 01 从 `page/` 导出任何新符号：编译期锁存比对的 `MolvisSurface` 类型今天已在 `page/src/lib/mount-opts.ts:9` 存在，`@/*` → `../page/src/*` 别名（`vsc-ext/tsconfig.json:7-9`）即可解析。
- **`page-host-init-single-path` 必须已立 spec**（见 Summary 1）。
- 分支尖端全绿；本环不携带任何「既有红」豁免。

### 1. `PageSurface` 在 protocol 里结构性再声明

`vsc-ext/src/protocol/messages.ts` 是 **host-safe** 模块（无 stage/page 运行时 import），扩展宿主 bundle 与 node/mocha 单测都要能加载它，因此不能从 `page/` import 类型。沿用同文件既有先例 `FileFormat`（`:19-33`，带 `@see stage/src/io/formats.ts`）与 `LoadMode`（`:39`）：

```ts
/** @see vsc-ext/src/webview/attachPageHost.ts `_SurfaceLockstep` */
export const PAGE_SURFACES = ["full", "canvas"] as const;
export type PageSurface = (typeof PAGE_SURFACES)[number];
```

与既有先例的差别是**更强**：`FileFormat` / `LoadMode` 至今**没有任何守卫**，纯靠 `@see` 注释约定（既有的未守卫漂移；在此点名即为披露，本环不扩大也不修它）。`PageSurface` 由 `attachPageHost.ts` 中的编译期 `AssertEq<PageSurface, MolvisSurface>` 锁死，漂移会让 `typecheck:vsc-ext` 变红。声明处的 `@see` 反向引用保证这道锁从声明点可发现。

### 2. `init.surface`

`HostToWebviewMessage` 的 `init` 成员增加可选字段 `surface?: PageSurface`。可选，因为 Quick look / Stage / Sketch 的 `init` 不带 surface 概念，`handleCore` 对它一无所知也无需改动。不新增消息类型，不新增允许表（见 Summary）。

### 3. `hostSurfaceOf` 的位置

```ts
export function hostSurfaceOf(message: HostToWebviewMessage): PageSurface | null;
```

放在 `vsc-ext/src/protocol/messages.ts`：纯 schema 读取（`type === "init"` 且 `surface` 属于 `PAGE_SURFACES`），无 DOM、无 stage、无 `vscode` 依赖，因而是本环**唯一能被 node/mocha 真正单测**的行为。放进 `attachPageHost.ts` 会把它埋在不可单测的模块里。返回 `null` 表示「这条消息没有 surface 主张」，而不是默认 `"full"`——默认值属于 page 自身，宿主不主张时 page 保持现状。

### 4. 初始 surface 必须搭 `init` 这班车

webview 生命周期是 `ready`（webview 发）→ `init`（宿主发）。宿主在收到 `ready` 之前无法发任何东西，而 `init` 是它发出的第一条消息。再造一条 `setSurface` 意味着 page 先按默认 surface 画一帧、再被纠正，出现可见的 chrome 闪动；搭 `init` 则 surface 与 config/settings 同跳到达，只调整一次。

### 5. `createInitMessage(surface?)` 与真实生产者

`vsc-ext/src/extension/configuration.ts` 的 `createInitMessage()` 增加可选参数 `surface?: PageSurface`，仅在传入时写入该字段。真实生产者是 `vsc-ext/src/extension/panels/pagePanel.ts:61`（`case "ready"`），传 `"full"`——page 面板就是全 chrome 产品外壳，与今天的挂载默认一致，行为零变化。Quick look / Stage / Sketch 的四个调用点一行不改（可选参数缺省即旧行为）。该字段因此不是死面：本环即有生产者，也有消费者。link 03 把这个字面量换成面板存的那一位。

`configuration.ts` 是 extension-host 代码，继续零 `@molcrafts/…` require——新增的只是一个类型 import 和一个字段（`manifest.test.ts` 对构建产物的断言不受影响）。

### 6. `attachStageHost` 的观察缝（唯一一处对既有文件的改动）

```ts
/**
 * Non-claiming pre-dispatch observer: sees every accepted host message before
 * `handleCore`. Returns nothing — it can never claim, reorder or suppress a
 * message.
 */
onMessageSeen?: (message: HostToWebviewMessage) => void;
```

在 `handleMessage`（`:306-309`）最顶端调用：

```ts
const handleMessage = (message: HostToWebviewMessage): void => {
  onMessageSeen?.(message);
  if (handleCore(message)) return;
  if (onExtraMessage?.(message)) return;
};
```

**改动既有文件的正当性**：这是**加缝**，不是改行为。两行：一个可选字段声明、一次可选调用。返回类型是 `void`，语言层面不可能占用消息或改变 `handleCore` / `onExtraMessage` 的次序。

**「Quick look 不受影响」的结构性证明**（不是口头保证）：(a) `attachQuickViewHost.ts` 的 `AttachQuickViewHostOptions` 是 `Omit<AttachStageHostOptions, "isHostMessage" | "onExtraMessage">`——本环把 `"onMessageSeen"` 一并加入该 `Omit`，于是 Quick look **在类型层面就无法传入**这个回调，`onMessageSeen?.()` 在该路径恒为 no-op；(b) `webview/controller.ts` 不传该选项；(c) `attachSketchQuickViewHost.ts` 根本不调用 `attachStageHost`（`:53-80` 是独立实现，自建 window 监听、自建 switch、自带 `SketchComposer`）。

### 7. `attachPageHost` 是独立模块，不是 `attachHost(kind, opts)`

```ts
// vsc-ext/src/webview/attachPageHost.ts (new)
export interface AttachPageHostOptions
  extends Omit<AttachStageHostOptions, "onMessageSeen"> {
  /** Called when the host declares a surface (today: on `init`). */
  onSurface: (surface: PageSurface) => void;
}

export function attachPageHost(app, options): StageHostHandle {
  const { onSurface, ...rest } = options;
  return attachStageHost(app, {
    ...rest,
    onMessageSeen: (m) => {
      const surface = hostSurfaceOf(m);
      if (surface) onSurface(surface);
    },
  });
}
```

`isHostMessage` **不覆盖**——默认的 Quick look 集合已含 `"init"`（`messages.ts:176`），page 不需要更宽的集合。

不并进 `attachHost(kind, opts)` 的理由是**选项类型**：合并后的选项对象必须同时容纳 `onSurface`（page 专有）与 `onExtraMessage`（Stage 编辑器专有），每个调用方都得忽略一半字段——正是 `design-preferences.md:68` 禁止的 god data structure。两个入口各自的选项类型精确描述各自的调用方。

（**撤回前稿的一条假论证**：先前以 `attachSketchQuickViewHost` 为「同族薄包装先例」——不成立，它是独立实现，不立任何先例。结论改由上述选项类型论证独立支撑。）

编译期锁存写在同一文件：

```ts
type AssertEq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _SurfaceLockstep: AssertEq<PageSurface, MolvisSurface> = true;
```

### 8. bootstrap 的消费者

`vsc-ext/src/page/bootstrap.tsx` 把 `attachStageHost` 换成 `attachPageHost`，并保留今天被丢弃的 `MountedApp`（`:44`）：

```ts
onSurface: (surface) => mounted?.setOpts({ surface })
```

`enableDrop: false` / `onBusy` 原样保留。挂载期默认不变——宿主主张只会**覆盖**它，不主张时行为与今天逐字相同。

`setSurface` 早于挂载到达的问题不存在：本环没有 `setSurface`，初始 surface 搭 `init`，而宿主只在收到 `ready` 之后才发 `init`。

### 9. `html.ts` 的资产版本

本环改变了 page webview bundle 的内容（`bootstrap.tsx` 进入打包图），Chromium 按 `?v=` 查询键缓存 `page/index.js`（`html.ts:17`、`:132`）。不 bump 就会出现「扩展已更新、webview 仍跑旧 bundle」：宿主发 `init.surface` 而旧 bundle 无消费者，症状是**静默无效**。`WEBVIEW_ASSET_REV` 由 `"cmd-attrib-18"` bump 到 `"page-surface-19"`。CSP 不动（不引入新脚本来源）。

### Reuse decision

- `reuse` `attachStageHost`（`:80`）—— 送达、过滤、load/settings/save 全部复用；本环只加一条观察缝。
- `reuse` 默认 `isHostMessage` / `isQuickViewHostMessage`（`:206`）—— `"init"` 已在表内，不新增第二张表。
- `reuse` `WEBVIEW_ASSET_REV` / `scriptUri` 缓存失效机制（`html.ts:7`、`:17`）—— bump，不新建机制。
- `pattern` `FileFormat` / `LoadMode` 的结构性再声明 + `@see` 约定（`messages.ts:18-39`）—— `PageSurface` 照此命名与注释，并额外加编译期锁存。
- `new` `hostSurfaceOf` / `attachPageHost` / `onMessageSeen` —— 树内无对应物：没有任何既有符号从 `HostToWebviewMessage` 读 surface，没有 page 专用的 host 桥，也没有非占用的前置观察缝。

## Files to create or modify

- `vsc-ext/src/protocol/messages.ts` —— `PAGE_SURFACES` / `PageSurface`、`init.surface`、`hostSurfaceOf`
- `vsc-ext/src/protocol/index.ts` —— 重导出上述新符号
- `vsc-ext/src/webview/attachStageHost.ts` —— `onMessageSeen` 可选字段 + `handleMessage` 顶端调用（两行加缝）
- `vsc-ext/src/webview/attachQuickViewHost.ts` —— `"onMessageSeen"` 加进 `Omit` 列表
- `vsc-ext/src/webview/attachPageHost.ts` (new) —— page 专用桥 + `_SurfaceLockstep`
- `vsc-ext/src/extension/configuration.ts` —— `createInitMessage(surface?)`
- `vsc-ext/src/extension/panels/pagePanel.ts` —— `case "ready"` 传 `"full"`
- `vsc-ext/src/page/bootstrap.tsx` —— 改用 `attachPageHost`，`onSurface` → `setOpts({ surface })`
- `vsc-ext/src/extension/panels/html.ts` —— `WEBVIEW_ASSET_REV` → `"page-surface-19"`
- `vsc-ext/tests/unit/protocol/messages.test.ts` —— `hostSurfaceOf` 用例

## Tasks

- [ ] Verify link 01 landed MountedApp.setOpts and that page-host-init-single-path is a filed spec; stop and route if either is missing
- [ ] Write failing unit tests for hostSurfaceOf in vsc-ext/tests/unit/protocol/messages.test.ts
- [ ] Implement PAGE_SURFACES, PageSurface, init.surface and hostSurfaceOf in vsc-ext/src/protocol/messages.ts with @see docstrings, and re-export from vsc-ext/src/protocol/index.ts
- [ ] Add the non-claiming onMessageSeen observer to vsc-ext/src/webview/attachStageHost.ts and widen the Omit in vsc-ext/src/webview/attachQuickViewHost.ts
- [ ] Implement attachPageHost + _SurfaceLockstep in vsc-ext/src/webview/attachPageHost.ts
- [ ] Extend createInitMessage(surface?) in vsc-ext/src/extension/configuration.ts and pass "full" from vsc-ext/src/extension/panels/pagePanel.ts
- [ ] Wire vsc-ext/src/page/bootstrap.tsx to attachPageHost with onSurface mapped to setOpts({ surface })
- [ ] Bump WEBVIEW_ASSET_REV to "page-surface-19" in vsc-ext/src/extension/panels/html.ts
- [ ] Verify in a live VS Code window that the page panel applies the host surface once, with no Quick look regression
- [ ] Run full check + test suite

## Testing strategy

单测只覆盖 `vsc-ext` 的 node/mocha 环境能真正执行的模块（该环境无法 import stage/page 运行时），路径镜像源码。

- `vsc-ext/tests/unit/protocol/messages.test.ts`（既有文件，扩充）
  - happy：`hostSurfaceOf({ type: "init", surface: "canvas" })` → `"canvas"`；`surface: "full"` → `"full"`。
  - edge：`{ type: "init" }` → `null`；`{ type: "init", surface: "compact" }` → `null`；`{ type: "applySettings", surface: "canvas" }` → `null`（只有 `init` 承载主张）。
  - edge：`isQuickViewHostMessage({ type: "init", surface: "canvas" })` 仍为 `true`（page 不需要第二张允许表这一设计前提的守卫；该表若被改窄，本条会红）。
  - 既有的 `QUICK_VIEW_HOST_MESSAGE_TYPES` 逐字断言（`messages.test.ts:9`）一字不改仍绿。
- **不可单测的部分与理由（明说）**：`attachStageHost.ts` / `attachPageHost.ts` / `bootstrap.tsx` 传递性 import stage/page 运行时，`configuration.ts` 值导入 `vscode`——在 node/mocha 中均不可加载。它们的守卫是：`AssertEq<PageSurface, MolvisSurface>` 编译期锁存（`typecheck:vsc-ext` 是 CI 闸）、`attachQuickViewHost` 的 `Omit` 使 Quick look 在类型上无法传入观察缝、以及最后一项实机验证。**不为它们制造 mock-only 的假闸。**
- **本环不新增 `regressions/` 脚本**，理由显式记录：`vsc-ext` 是 private 包（`package-architecture.md:23`，无 `exports`，`main: ./out/extension.js`），`PageSurface` 是内部 wire schema 而非已发布公开 API，没有可 import 的 `dist` 公开路径；而源码 grep 式脚本在「字符串留存、行为删除」时会通过、在无关重命名时会失败，按 CLAUDE.md「每道闸必须被证明会咬人」不是闸，不得以 `regressions/traj-ingest-04-range.ts:27-39` 的既有先例为授权（那是继承的债，不是权威）。该契约由上述协议单测持有。

## Out of scope

- **`surfaceChanged`（webview → host）** 及其 `pagePanel.ts` 消费者：整体归 link 03。本环不预埋该 union 成员、不接 `onSurfaceChange → postMessage`——落一个已知无消费者的新面，是 `design-preferences.md:15-19` 与 shape check 3（`:78`）直接禁止的；「省掉 03 再改一次 `bootstrap.tsx`」是 diff 成本论证，法条胜过它。
- **`page-host-init-single-path`**：本环只披露与路由，不就地修。
- **`FileFormat` / `LoadMode` 的锁存补齐**：既有未守卫漂移，本环点名披露，修它属于另一份 spec。
- **Quick look / Stage / Sketch 的 surface 概念**：三者没有 chrome 布局，不接 `init.surface`。
- **`regressions/` lane 条文修订**：经 `/mol:note`，不在本 spec 内改规则文件。
