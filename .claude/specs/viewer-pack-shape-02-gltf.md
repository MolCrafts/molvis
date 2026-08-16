---
title: glTF 导出移出 viewer 包体，改走 ./export-gltf 公共子路径
status: code-complete
created: 2026-08-16
grilled: true
---

# glTF 导出移出 viewer 包体，改走 ./export-gltf 公共子路径

## Summary

把 glTF 导出从 stage 的 app 图里摘出去：删掉休眠的 `Molvis.exportGLTF` 与它在桶文件上的再导出，让 bundled viewer 的 CDN 包不再产出 `1~gltf.js`（4.8 kB）和 `1~@babylonjs/serializers` 分块（298.5 kB）；同时把导出器本体以 `@molcrafts/molvis-stage/export-gltf` 公共子路径暴露出来，并把该 id 接入插件宿主的**惰性**模块桶，使未来的官方 gltf-exporter 插件（molvis-plugins-official 仓，另立 spec）能通过 page 插件宿主拿到同一实例。能力不减少，只是从「viewer 启动图里的死重」变成「插件按需拉取的公共子路径」。`stage/src/export/gltf.ts` 一字不改，`@babylonjs/serializers` 仍是 stage 依赖。

## Design

**要删的三个点（repo 全域已核实，仅此三处）**

- `stage/src/app.ts:27` — `import type { GltfExportOptions } from "./export/gltf";`
- `stage/src/app.ts:742-757` — `exportGLTF` 方法及其 jsdoc（含 `await import("./export/gltf")`）
- `stage/src/index.ts:323` — `export { exportFrameToGLB, type GltfExportOptions } from "./export/gltf";`

图证据：`element.ts:329` 的 `await import("./web_component_runtime")` 拉入 `app.ts`，而 `app.ts:752` 的动态 import 是进入 `export/gltf.ts` 的**唯一**边；`gltf.ts:171` 再惰性拉 `@babylonjs/serializers`。切掉方法即同时抹掉两个异步分块。`page/src`、`vsc-ext/src`、`python/src`、`stage/tests` 零调用方——这是一次休眠代码的移动，不是行为变更。

**公共面变更，点名不静默（两个方向）**

1. **移除**：`@molcrafts/molvis-stage` 根桶不再导出 `exportFrameToGLB` / `GltfExportOptions`，`Molvis` 实例不再有 `exportGLTF()`。这是对已发布 0.2.0（stage 为 experimental 阶段）公共面的删除，但同一符号在新子路径上原地可达，净效果是**搬家不是砍功能**。
2. **新增**：`stage/package.json` 的 `exports` 增 `./export-gltf`。按 CLAUDE.md 不变量，子路径导出即公共 API，此为**有意**的公共面扩张。

不做兼容 shim、不做 deprecated 别名转发（沿用 notes 2026-08-03「refactor, not compatibility」）。

**为什么这一环必须跨包（不可再拆）**

`plugin/src/externals.ts:14` 的 `PLUGIN_HOST_MODULE_IDS` 与 `page/src/plugins/host_shared.ts:44` 的 `as const satisfies Record<EagerHostModuleId, unknown>` 是编译期互锁：只加 id 不在 page 侧归桶 → `EagerHostModuleId` 多出一个未注入成员 → page typecheck 红。两包的改动是一次原子提交，拆开必出不可落地的红环。

**惰性桶，不是 eager 桶**

新 id 进 `LazyHostModuleId`（`host_shared.ts:30`）、`PluginHostModules`（:46-49）、`getPluginHostModules` 的 `Promise.all`（:60-67）三处。放 eager 桶会用静态 import 把 serializers 重新钉进 page 启动图，正好抵消本环目的——`host_shared.ts:9-12` 的文件头注释写的就是这条。`page/src/plugins/loader.ts` 不动：它对 `Object.entries` 泛型处理，导出名 `exportFrameToGLB` 满足 `loader.ts:51` 的标识符正则，`GltfExportOptions` 是纯类型、编译期擦除。

**已核实不存在的镜像（记录在案，避免下次重查）**

- vsc-ext 无对应面：`rslib.webview.config.mts:92`、`rslib.webview.page.config.mts:45`、`rslib.webview.worker.config.mts:58` 均 `externals: []`，无 host_shared 同构物、无插件 loader。
- `plugin/README.md:22-27` 的表格只列 SDK 自身导出路径，不是 host id 清单。
- `page/src/plugins/index.ts:2-4` 是整体再导出，无需改。
- `docs/assets/molvis-stage/` 是 .gitignore（:5）里的文档构建产物，从 node_modules 暂存而来，**不是**手改对象。
- 唯一需要手改的散文 id 清单：`docs/development/plugins.md:155-158`。

**本环形态约束**：零新增运行时符号、零新增模块、零新增类。law 的 OOP/内聚要求在这里的落点是「不要为了软化桶导出的移除而新造包装类、转发函数或门面」——删除就是删除，新公共面就是 manifest 里的一行。

### Reuse decision

本次调用未随附 `librarian_report`（caller 未标注 blueprint refresh deferred）。因此复用面按磁盘实证逐项裁决，且本环**不新增任何符号**，不存在「重写既有候选」的风险：

- `reuse exportFrameToGLB`（`stage/src/export/gltf.ts:60`）— 源码零改动，仅改变其可达路径。
- `reuse GltfExportOptions`（`stage/src/export/gltf.ts:20`）— 同上，随子路径的 `.d.ts` 导出。
- `reuse` kebab 子路径 → 嵌套 dist 的既有写法 — 照抄 `core/package.json:27-31`（`./element-picker` → `dist/element_picker.js`）与 `:67-71`（`./workload` → `dist/workload/index.js`）：`types`/`import`/`default` 三元组，`default` 与 `import` 同值（全仓 `type: module`，无 require 分支）。
- `reuse` 惰性宿主桶写法 — 照抄 `host_shared.ts` 现有 molplot / molvis-stage 两条惰性成员，不新造解析器。
- `reuse` 回归脚本形状 — 照抄 `regressions/theme-tab10-ovito-07-prune.ts`（本地 `assert`、`readFileSync` 文本断言 + 真实深路径 import、结尾 `console.log("<slug> ok")`）。
- `new color_override_keys`（`stage/src/color_override_keys.ts`）— 铁律补丁，不是软化桶删除的包装。`atom_buffer` 曾 value-import `ColorByPropertyModifier` 来读三个列名，该模块 value-import `Frame`，裸 node 深引 `dist/export/gltf.js` 会实例化 WASM，断言 4 红。新模块零 import，只拥有 `__color_r/g/b` 三个字符串；artist 与四个 color modifier 都从这里读。不进根桶。

## Files to create or modify

- `stage/src/app.ts` — 删除 `:27` 类型导入与 `:742-757` `exportGLTF`（含 jsdoc）
- `stage/src/index.ts` — 删除 `:323` 桶再导出
- `stage/src/color_override_keys.ts` (new) — Wire 列名；切断 artist → ColorByPropertyModifier → molrs WASM
- `stage/src/artist/atom_buffer.ts`, `stage/src/artist/representation_draw.ts`, `stage/src/modifiers/{AssignColorModifier,ClusterModifier,ColorByPropertyModifier,structure_order_shared}.ts` — 改从 `color_override_keys` 读列名
- `stage/package.json` — `exports` 增 `./export-gltf`，置于 `./element`（及其后的 `./viewer`）之后、`./io` 之前
- `plugin/src/externals.ts` — `PLUGIN_HOST_MODULE_IDS`（`:14-31`）末尾追加 `"@molcrafts/molvis-stage/export-gltf"`
- `page/src/plugins/host_shared.ts` — 惰性桶三处：`LazyHostModuleId`（`:30`）、`PluginHostModules`（`:46-49`）、`getPluginHostModules` 的 `Promise.all`（`:60-67`）
- `docs/development/plugins.md` — `:155-158` 的散文 id 清单补上新子路径
- `regressions/viewer-pack-shape-02-gltf.ts` (new)

## Tasks

- [x] Delete `exportGLTF` and the `GltfExportOptions` type-only import from `stage/src/app.ts` (`:27`, `:742-757`)
- [x] Remove the `./export/gltf` re-export from the barrel `stage/src/index.ts` (`:323`)
- [x] Add the `./export-gltf` subpath (types/import/default → `dist/export/gltf.{d.ts,js,js}`) to `stage/package.json` exports
- [x] Append `"@molcrafts/molvis-stage/export-gltf"` to `PLUGIN_HOST_MODULE_IDS` in `plugin/src/externals.ts`
- [x] Wire the new id into the lazy bucket in `page/src/plugins/host_shared.ts` (`LazyHostModuleId`, `PluginHostModules`, `getPluginHostModules`)
- [x] Update the host-module id list prose in `docs/development/plugins.md:155-158` (no eager/lazy claim beyond what the code does)
- [x] Add regression example `regressions/viewer-pack-shape-02-gltf.ts` (public API only; hard-coded goldens, no third-party runtime)
- [x] Verify the gate bites: run `node regressions/viewer-pack-shape-02-gltf.ts` against the pre-rebuild `stage/dist` (must exit non-zero), then `npm run build:stage` and re-run (must print `viewer-pack-shape-02-gltf ok`)
- [x] Run full check + test suite

## Testing strategy

**本环不新增单测，理由写在明处（非静默跳过）**：这次改动零新增运行时逻辑——三处删除、一行 manifest、一个 id、三处类型桶接线、一段文档。可测的行为面已被现有覆盖钉住，且新面的正确性由比单测更强的编译期约束承担：

- `stage/tests/export/gltf.test.ts:5` 直接 `import { exportFrameToGLB } from "../../src/export/gltf"`（不经桶），**保持一字不动**——它继续绿就是「导出器本体未被本环碰过」的证明。
- `plugin/` 无测试 runner；id 清单与宿主注入表的一致性由 `host_shared.ts:44` 的 `satisfies` 在编译期双向锁定，跑 `npm run typecheck` 即为该门。page typecheck 是惰性桶接线是否成立的判定面。
- `page/tests/plugins/loader_graph.test.ts` 覆盖 loader 改写路径，本环不改 loader，保持不动。

**dist 形状门（本环唯一新增可执行断言）** — `regressions/viewer-pack-shape-02-gltf.ts`，依赖为零的 Node ESM，仅用可擦除 TS 语法（无 enum、无参数属性；runner 是 `package.json:99` 的裸 `node $f` 类型剥离），本地 `assert(cond, msg)`，结尾 `console.log("viewer-pack-shape-02-gltf ok")`。断言（golden 全为写死的结构字面量，非任何工具产出，无第三方运行时、无 WASM 实例化）：

1. `stage/dist/1~gltf.js` 不存在。
2. `stage/dist/1~@babylonjs/` 目录不存在（当前树上是 `stage/dist/1~@babylonjs/serializers.js`）。
3. `stage/dist/index.js` 文本不含 `exportFrameToGLB`。
4. 深路径 `import("../stage/dist/export/gltf.js")` 解析成功且 `exportFrameToGLB` 是 function（先例：`regressions/optimize-staging-03-command.ts:45` 已在纯 Node 下深引 Babylon 闭包并通过；`gltf.ts` 对 molrs 的引用是类型级，dist 里已擦除，故不触发 WASM）。
5. `stage/package.json` 的 `exports["./export-gltf"]` 的 `types`/`import` 指向 `./dist/export/gltf.d.ts` / `./dist/export/gltf.js`，且这两个文件在磁盘上存在——manifest 与产物一致才是这一环真正的公共面契约。

**门必咬**（CLAUDE.md「Every gate must be proven to bite」）：磁盘上现存的 `stage/dist` 正是删除前的构建产物（含 `1~gltf.js` 与 `1~@babylonjs/serializers.js`），因此改完源码、`npm run build:stage` 之前跑一次脚本必须非零退出；重建后转绿。这条在 Tasks 里是独立一步，不允许只跑绿的那一次。

**lane 已接线，无需新增**：`ci.yml:128-140` 走 build stage → `check:pack` → `check:regressions`；`.pre-commit-config.yaml:102-116` 在 pre-push 镜像同两步。`regressions/` 是 dist 形状断言的受认可场地（`.claude/notes/package-architecture.md:71-79`），不建 `scripts/`。

**交付门**：`biome check . && npm run typecheck` 全绿（page typecheck 证明惰性桶接对），`npm test` 全绿，`npm run check:pack` 仍报 ok。

## Out of scope

- **官方 gltf-exporter 插件本身**（molvis-plugins-official 仓）——另立 spec；本环只铺路，不写调用方。
- **ring 01 的领地**：`viewer.js` → `main.js` 入口改名、chunk 命名、`check:pack` 收紧、`1~` 前缀语义与 `workerChunkLoading` 一律不动；本环断言绝不依赖 ring 01 是否已落地。
- `stage/src/export/gltf.ts` 源码的任何改动（API 调整、序列化器解耦、体积优化）。
- 移除或替换 `@babylonjs/serializers` 依赖（`stage/package.json:98` 保留）。
- molrs 版本变动。
- vsc-ext 侧镜像（已核实三份 webview rslib config 均 `externals: []`，无对应面）。
- `plugin/README.md`（其表格不是 host id 清单）。
- `docs/api/typescript.md` 的 `./export-gltf` 用法示例——**点名推迟，不静默**：本环没有任何真实调用方，此刻写示例等于写假用法；随 gltf-exporter 插件 spec 连同可跑的调用一起落地。
- e2e / 浏览器验证（铁律：无 e2e lane）。
