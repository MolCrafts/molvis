---
title: 重命名 stage CDN 入口为 main.js 并收紧 pack 形状门禁
status: code-complete
created: 2026-08-16
grilled: true
---

# 重命名 stage CDN 入口为 main.js 并收紧 pack 形状门禁

## Summary

把 stage 打包版 CDN 入口产物从 `dist/viewer.js` 改名为 `dist/main.js`，让每个 emit 出来的 chunk 都有可读名字（消灭 `dist/7642.js`），并把 `check:pack` 从"能过"提升为"会咬"：新增旧名与根目录数字名 chunk 的封禁，同时修好一个被发现的预算漏算。文件名变了，公开 API 的 `./viewer` 子路径不变，因此下游 `import "@molcrafts/molvis-stage/viewer"` 一行都不用改；文档里写死的物理路径与 jsDelivr 固定版本号则必须同步。本环额外落一个 `regressions/` 脚本，把 dist 形状锁成硬断言，接到已经真实生效的 CI / pre-push 车道上。

## Design

**受影响实体**

- `stage/rslib.config.ts` 的第二个 lib item（`bundle: true`，`stage/rslib.config.ts:61-128`）：入口键 `viewer` → `main`；`tools.rspack` 内在既有 `config.optimization` 展开旁**追加** chunk 命名策略。
- `stage/package.json` 清单三处 + `check:pack` 一条脚本。
- 文档侧两个 URL 使用点与一张入口表。
- 新增一个 `regressions/` 断言脚本。

**入口改名是被迫选择（必须记录理由）**

operator 给了 `index.js` 与 `main.js` 两个候选，`index.js` **不可用**：同一个 `dist/` 里，`bundle: false` 的 lib item（`stage/rslib.config.ts:39-60`，`entry: { index: "./src/**" }`）已经把 `stage/src/index.ts` 逐模块 emit 成 `dist/index.js`，改名会直接撞车。因此本环取 `main`。已确认 `stage/src/` 下不存在 `main.ts`，`dist/main.js` 是空位。

**文件名与子路径是两件事**

`exports` 的 `./viewer` 子路径是公开 API（`docs/interfaces/web/install.md:27` 的 import 示例、`:33-34` 条目、`stage/README.md:37` 入口表都在描述它）。本环只改子路径**指向的目标文件名**，子路径本身不动——改子路径是纯粹的破坏性变更且无收益。

**`sideEffects` 是载荷性的**

`stage/package.json:73` 的 `"./dist/viewer.js"` 必须同步改成 `"./dist/main.js"`。漏掉这一条，rspack 会把 `element_entry.ts` 判成无副作用并 tree-shake 掉 `defineMolvisViewer()` / `defineMolvisStyleGallery()`（`stage/src/element_entry.ts:3-4`），自定义元素静默不注册。本仓库对 auto-register 模块已经踩过一次同样的坑，本环把它作为 Task 级警告写死，并由回归脚本的字符串断言兜住。

**jsDelivr pin 是本环要拍板的活决策，不是机械替换**

两处 CDN URL 都固定在 `@molcrafts/molvis-stage@0.2.0`（`docs/assets/javascripts/molvis-elements.js:23`、`docs/interfaces/web/install.md:48`），而**已发布的 0.2.0 里只有 `dist/viewer.js`**。只把路径段改成 `dist/main.js` 而不动 pin，得到的是 404，比"旧但能用"更糟；`check:versions`（根 `package.json:105`）只覆盖清单版本，不会自动推这两个字符串。定规则：

- 路径段 → `dist/main.js`；
- pin 版本 → 取根 `package.json` 的 `version` 字段（唯一真源），**不得凭空发明发布号**；
- `molvis-elements.js` 加一行注释，说明该 fallback 只有在该版本发布之后才解析得到，而主路径始终是 `node_modules/@molcrafts/molvis-stage/dist` 的 staged 副本（`zensical.toml:13-16` 整目录 watch/copy，与文件名无关，因此 `zensical serve` 与 docs CI 不受影响）。

**chunk 命名**

`dist/7642.js`（21.3 kB）是带数字 ID 的 rspack runtime/bootstrap chunk。在 `stage/rslib.config.ts:89-108` 的 `config.optimization` 展开里追加 `chunkIds: "named"`（或显式命名 runtime chunk——实现者以产物名字确实可读为准）。硬约束：

- `1~` 前缀是 rslib 的 lib-item 命名空间，**必须保留**，它是与 `bundle: false` 产物（`dist/app.js` 等）的撞名护栏；
- 不碰 `workerChunkLoading: "import"`（`:87`），不碰 `bundle: false` item 的逐模块 / dts 行为；
- 本环运行时 ring 02 的 chunk（`dist/1~gltf.js` 等）**仍然存在**，任何断言都不得假设它们已消失。

**check:pack 收紧（含一处 rot-you-touch 修复）**

`stage/package.json:84`，cwd 为 `stage/`，find 模式相对 `dist/`；保持 `;` 串联的 POSIX sh 风格、先 echo 违规路径再 `exit 1`、结尾保留成功 echo。

- 子句 (a) 存在性：`[ -s dist/viewer.js ]` → `dist/main.js`；
- 子句 (c) 违禁产物名：新增根目录**纯数字名** chunk 封禁与旧名 `viewer.js` 封禁。⚠ 纯 glob `[0-9]*.js` 过宽——glob 的 `*` 会命中 `1~gltf.js`、`1~lib-babylonjs.js` 等所有数字开头的合法 chunk（本环运行期它们在场，门会在正确构建上误咬）。封禁语义必须是 `^[0-9]+\.js$`（如 `find dist -maxdepth 1 -name '[0-9]*.js' | grep -E '/[0-9]+\.js$'` 或等价写法）；
- 子句 (d) 预算 find：`'viewer.js'` → `'main.js'`；并修好发现的**漏算**：`-name '1~*'` 只匹配 basename，于是 `dist/1~@babylonjs/serializers.js`（298.5 kB，位于名为 `1~@babylonjs` 的**目录**内）从未计入 25 MB 求和 —— 追加 `-path` 匹配覆盖嵌套 `1~*/` 产物。预算数字 25 MB（26214400）不变。

**Reuse decision**

本次调用未附 `librarian_report`，以下复用判定基于已在磁盘核对的既有实现：

- `reuse` `check:pack`（`stage/package.json:84`）—— 原地收紧既有门禁，不另起新脚本；仓库禁止 `scripts/` 目录。
- `pattern` `regressions/theme-tab10-ovito-07-prune.ts` —— 新回归脚本逐字沿用其形状：无依赖 node ESM、可擦除语法 TS、局部 `assert(cond, msg)`、`readFileSync` 文本断言、结尾 `console.log("<slug> ok")`。命名、构造与报错风格照抄，读起来必须像既有代码。
- `reuse` 根 `package.json:99` 的 `check:regressions` 与 `:98` 的 `check:pack` 转发 —— 车道已接好（`.github/workflows/ci.yml:128-140`，`.pre-commit-config.yaml:92-112`），本环只往里加文件，不新增车道。
- `new — regressions/viewer-pack-shape-01-names.ts` —— dist 形状目前无任何守卫；`stage/tests` 按 `.claude/notes/package-architecture.md:71-79` 不得读 dist，故必须新建，不存在可泛化的既有断言脚本。

## Files to create or modify

- `stage/rslib.config.ts` — 入口键 `viewer` → `main`（`:67`）；`tools.rspack` 内追加 chunk 命名（`:89-108`）；顶部 JSDoc 中"bundled `viewer` CDN entry"措辞随之更新。
- `stage/package.json` — `exports["./viewer"]` 的 `import`/`default`（`:17,18`）、`sideEffects`（`:73`）、`check:pack` 四个子句（`:84`）。
- `stage/README.md` — 入口表附近说明打包产物文件名为 `dist/main.js`（子路径 `:37` 不变）。
- `docs/interfaces/web/install.md` — `:48` CDN URL 路径段与 pin。
- `docs/assets/javascripts/molvis-elements.js` — `:12` staged 包路径、`:23` jsDelivr fallback URL、以及新增的 pin 说明注释。
- `regressions/viewer-pack-shape-01-names.ts` (new) — dist 形状硬断言脚本。

## Tasks

- [x] Rename the bundled CDN entry key from `viewer` to `main` in `stage/rslib.config.ts` (`:67`) and update the file's header JSDoc wording
- [x] Add meaningful chunk naming in `stage/rslib.config.ts` `tools.rspack` (`:89-108`), keeping the `1~` prefix, `workerChunkLoading: "import"`, and the `bundle: false` item untouched
- [x] Update `stage/package.json` manifest to `./dist/main.js` in `exports["./viewer"]` (`:17,18`) and in `sideEffects` (`:73`) — WARNING: missing the `sideEffects` entry tree-shakes `defineMolvisViewer()` / `defineMolvisStyleGallery()` away (documented prior failure mode for auto-register modules)
- [x] Tighten `check:pack` in `stage/package.json` (`:84`): clause (a) `dist/main.js`, clause (c) ban `viewer.js` + root-level PURELY-numeric names (`^[0-9]+\.js$` semantics — a bare `[0-9]*.js` glob over-matches `1~*.js` chunks and must not be used alone), clause (d) `main.js` plus `-path` coverage for nested `1~*/` output; keep the 26214400 budget and the POSIX-sh shape
- [x] Repoint docs URLs in `docs/assets/javascripts/molvis-elements.js` (`:12`, `:23` + pin comment), `docs/interfaces/web/install.md` (`:48`), and `stage/README.md`, taking the pinned version from the root `package.json` `version` field
- [x] Add regression example `regressions/viewer-pack-shape-01-names.ts` (dependency-free node ESM, erasable-syntax TS, hard-coded goldens, no third-party runtime)
- [x] Verify the pack gate bites: a decoy `stage/dist/viewer.js` and a decoy `stage/dist/1234.js` each make `npm run check:pack` exit non-zero; remove both decoys and confirm it returns green
- [x] Run full check + test suite (build.check green: biome 944 files 0 err, tsc --noEmit exit 0; check:pack + check:regressions green; heavy browser suite deliberately skipped per operator light-local-checks rule — zero src changes, pre-push/CI carry it)

## Hygiene

- simplify ran clean 2026-08-16: 1 applied (wc -c BSD padding -> tr -d, output deterministic), 1 rejected with reason (budget `[0-9]*.js` branch is NOT dead — sole budget coverage for digit-leading non-1~ artifacts; glob≠regex), 1 rule-capture routed to /mol:note (jsDelivr pins uncovered by check:versions)

## Testing strategy

**为什么本环没有 `tests/` 下的新单测。** 本环不新增任何 `src/` 模块——改动全部落在构建配置、包清单与文档字符串上，可观测对象是 **dist 产物形状**。按 `.claude/notes/package-architecture.md:71-79`，`stage/tests` 不得读 dist；在 `stage/tests/` 里塞一个读 `dist/` 的文件会打破该边界并造出一个假单测。因此证明车道是 `regressions/` + `check:pack`，两者都已经真实接线（`.github/workflows/ci.yml:128-129` build stage → `:133-134` check:pack → `:139-140` check:regressions；`.pre-commit-config.yaml:92-112` pre-push 镜像同样三步）。仓库不允许 `scripts/` 目录，故不另起校验脚本。

**RED 证据。** 回归脚本先于配置改动跑一次：当前 dist 里存在 `viewer.js`、`7642.js` 且没有 `main.js`，三条断言必须全红；改完配置重建后转绿。

**Regression example：`regressions/viewer-pack-shape-01-names.ts`**（本 spec 唯一回归示例，形状照抄 `regressions/theme-tab10-ovito-07-prune.ts`）

- happy path：`stage/dist/main.js` 存在且非空。
- edge：`stage/dist/` 根目录不存在 `viewer.js`（旧名彻底消失，而非并存）。
- edge：`stage/dist/` 根目录不存在任何 `^\d+\.js$` 名字的文件（`7642.js` 类数字 chunk 已消灭）。
- edge：`main.js` 文本中仍包含 `molvis-viewer` 与 `molvis-style-gallery` 两个自定义元素标签字符串 —— 这是 `sideEffects` 漏改导致注册被 tree-shake 的直接哨兵。
- 断言只针对根目录条目，**不假设 `1~gltf.js` 等 ring 02 chunk 不存在**（本环与它们共存）。
- goldens 全部是仓库内派生的字面量（来自 `stage/rslib.config.ts` 入口名与 `stage/package.json` exports），无第三方 oracle、无 WASM 实例化、无第三方运行时依赖；脚本以 `console.log("viewer-pack-shape-01-names ok")` 收尾，`node regressions/viewer-pack-shape-01-names.ts` 退出码 0。
- 语法约束：runner 是 Node 22 原生类型擦除（根 `package.json:99`），禁用 enum、参数属性等不可擦除语法。

**门禁会咬（gate-bites proof）**：手工放置 decoy `stage/dist/viewer.js` 与 decoy `stage/dist/1234.js`，各自单独存在时 `npm run check:pack` 必须非零退出并先 echo 出违规路径；验证后删除 decoy，真实 dist 上 `check:pack` 与 `check:regressions` 均为绿。

**文档校验**：`docs/` 与 `stage/README.md` 下不再出现 `dist/viewer.js` 字符串；两处 jsDelivr pin 的版本号与根 `package.json` 的 `version` 完全一致。

**全量**：`biome check . && npm run typecheck`，随后 `npm test`。

## Out of scope

- **ring 02（gltf chunk 驱逐）** —— `dist/1~gltf.js` 及其体积治理属于本链第二个 spec，本环只保证断言与其共存，不做任何驱逐。
- **`./viewer` 子路径改名** —— 公开 API，不动；只换其指向的文件名。
- **25 MB 预算数值调整** —— 只修漏算口径，数字保持 26214400。
- **`workerChunkLoading: "import"`、`asyncWebAssembly`、`IgnorePlugin` 封禁列表、`bundle: false` item 的逐模块/dts 行为** —— 全部不动。
- **molrs 版本** —— 不 bump。
- **`site/`** —— 生成产物，任何情况下不手改；改完 docs 源后由生成流程覆盖。
- **e2e / 浏览器驱动** —— 不引入；回归脚本是纯 node 断言，不是 e2e。
- **发布动作** —— 本环不发版；jsDelivr fallback 在对应版本发布前不可用，这一点写进注释而不是靠猜一个发布号绕过。
