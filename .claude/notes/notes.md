# Notes

Passive memory for MolVis. `/mol:note` syncs decisions here; every agent reads
recent entries for context.

## 2026-08-14 — Product themes are tab10 | ovito

Categorical type colors come from `Tab10Strategy` (default) or `OvitoStrategy`.
Element CPK always uses `ModernTheme`. `view.set_theme` / Python `THEME` accept
only `tab10` | `ovito`. Classic/Vivid theme classes are gone; ColorMaps `cpk`
and `vivid` stay as 118-element tables. Cartoon (not Ribbon) owns helix/sheet/coil
hex. Solid–liquid owns liquid/solid hex. Canvas background does not pick a
type palette.

## 2026-08-11 — DocsLink (no lectures in-panel)

Modifier / compute / optimizer tips → short borderless `DocsLink` to the
molpy handbook (`lib/molpy-docs.ts` maps ids). Style: text-only, accent, no
card/border; details live in docs, not the rail.

## 2026-08-11 — EdgePanel P2 (bottom ≡ L/R pull)

Bottom workbench uses shared `EdgePanel` from **molcrafts-ui**
(`blocks/edge-panel` + `use-pointer-drag`): hairline pull-up, drag resize,
snap-close. Product chrome (tabs/close/plugins) stays in
`WorkbenchBottomPanel`. molvis copy: `page/.../EdgePanel.tsx` (import remapped
to existing `usePointerDrag`). L/R stay `ViewerSidePanel` (drawer + focus trap
+ resizable shell) — EdgePanel already supports `side=left|right` for later.

## 2026-08-11 — Status overlay P1 (status bar removed)

No layout bottom status strip. `ViewerStatusOverlay` is borderless icon+text
(bottom-left canvas; alerts dismiss on click). `chrome.statusBar` still gates
the overlay for embed hosts.

## 2026-08-11 — Trajectory HUD P0 (out of status bar)

Trajectory filmstrip floats **centered on the canvas bottom** when length > 1.

## 2026-08-11 — Series first-class + post-policy MI audit

- Time/transport series: product labels in Compute picker; Generic panel
  Cancel (abort) + "No series yet"; ResultView knows lagTimes/msd/vacf fields.
- Draw MI audit: ribbon/bond comments + `wrap_locality` test — full `Box.wrap`
  only under `coords/wrap.ts`; MI delta is draw-only on post-policy frames.
- OVITO parity: time series / bond distributions marked done.

## 2026-08-11 — Coordinate policy + Rings compute

- **coordinate-frame-policy:** `stage/src/coords/*` pure wrap/unwrap;
  pipeline applies policy after compose (default `as-deposited`); wrap
  control lives on Simulation cell (Draw Box); WrapPBC/Unwrap share helpers.
- **compute-partial-first-class:** Compute → Rings (SSSR) with size chart +
  select ring atoms; `detectRings` builds topology from `atomi`/`atomj`;
  distribution.* labels in Generic picker.
- Spec open list empty after this close.

## 2026-08-11 — Spec ledger hygiene

Closed fossils that were already shipped in code: `app-abstraction-sink`,
`structure-id-boundary`, `compute-form-design-acceptance`, leftover
`optimize-worker-ship` files.

## 2026-08-10 — P2 pack shipped

- Sketch Quick View (`molvis.quickViewSketch`) — stage QV unchanged; sketch host
  + MOL V2000 peek; no page import.
- Multi-DS product: Replace primary / Add source, Primary badge, pipeline docs.
- DataInspector coarse 44px row height; short empty titles.
- Stage ResizeObserver rAF-coalesced during continuous layout.

## 2026-08-09 — Mobile PWA + structure deep links

Standalone `page/` is installable (manifest + SW). Open ingress:

- `?pdb=1CRN` → RCSB download
- `?url=https://…` → CORS fetch
- share-target POST + launchQueue for installed PWA

Deep links still work via `?pdb=` / `?url=` and Open file / paste.
There is no in-app “copy share link” chrome — Settings → App is install only.

**Platform matrix (locked):**

| | Open with (file_handlers) | Share to (share_target) | In-app file / deep link |
|---|---|---|---|
| Desktop Chromium | yes | n/a | yes |
| Android | unreliable | yes when installed | yes |
| iOS | no | no | yes only |
| WeChat | no | no | browser open + link |

Docs: `docs/interfaces/web/mobile-pwa.md`.

## 2026-08-09 — molrs handle tracking (sink once, reuse)

Canonical: [molrs-handles.md](./molrs-handles.md). Thin router in `CLAUDE.md`
**Invariants**. Codifies existing practice (Frame-owned MetaRegistry, no
`frame.free()` on trajectory LRU eviction) as the default for every new sink.

## 2026-08-05 — Canvas WYSIWYG = SceneIndex

Canonical: [canvas-sceneindex.md](./canvas-sceneindex.md). Thin router also
in `CLAUDE.md` **Invariants**.

## 2026-08-03 — vsc-ext: Quick View is the standard; no dual host bridge

**Product / host constraints (locked):**

1. **Refactor, not compatibility** — old dual stacks, viewTypes, and message
   forks may be deleted; no alias shims for deprecated paths.
2. **Dynamic loading** — VS Code webviews must not pay for the full page tree
   up front. L0 shell → L1 engine (`import()`) → L2 named capabilities.
3. **Only Quick View is sacred** — stage-only + deferred entry + stream load.
   Workspace / Sketch / Outline / Home may be redesigned freely.

**Implementation:**

- Single protocol: `vsc-ext/src/protocol/` (`HostToWebviewMessage` /
  `WebviewToHostMessage`, stage `FileFormat`, no format subsets).
- Normative bridge: `vsc-ext/src/webview/attachQuickViewHost.ts`.
- **Deleted** `page/src/hooks/useHostFileBridge.ts` — page is not a VS Code
  host adapter. Web/Python stay URL/WS; VS Code file IO is extension-owned.
- **Workbench hosts peer engines:** Stage | Sketch tabs, lazy L1 mount each.
  Commands: `openWorkbench` / `openStage` / `openSketch` / `openPage` /
  `quickView` (stage) + `quickViewSketch` (2D) / `loadInWorkbench`.
- **Open Page** is optional (`page/` React shell, separate rslib config so
  engines stay free of page). Default daily path is engines, not page.
- Shared bridge: `attachStageHost`; Workbench window router +
  `setWorkbenchSurface`. QV = stage-only message subset.
- **Host ↛ page for engines.** `page → sketch|stage`. Engine webviews import
  engines only; page entry is isolated (`rslib.webview.page.config.mts`).
- Supersedes unfinished activity-bar full-page design in
  `docs/specs/vsc-ext-surfaces.md`.

## 2026-07-31 — selection scope auto-bind + producer capability

- `isSelectionProducer` is **capability-based** (`ProducesSelection`): Invert,
  Expand, Select Type, Select overlapping, Clear, Expression Select, etc.
- Adding any `ConsumesSelection` modifier auto-binds `selectionScopeId` to the
  latest producer (or auto-creates a SelectModifier from the live pick).
- Parent selector shows for **all** consumers (including dual consume+produce).

## 2026-07-30 — left compute / right draw (analysis-nature modifiers)

**UX iron law (extends scene-modifier placement):**

1. **Pipeline modifiers that are analysis-nature** (structure order, density
   surfaces, vector fields, isosurfaces, …) register `usesLeftConfig: true`.
2. On **add or select**, open the left advanced panel with
   `surface="compute"` (algorithm params + recompute).
3. Pipeline bottom properties show `surface="draw"` only (colors, isovalue,
   opacity, arrow scale, …) — not a dead stub.
4. **Pure Analysis catalog** (charts) stays left-only. If the analysis can
   also drive the canvas, offer a button to **add a right-side pipeline
   modifier** (e.g. Cluster → Color by Property on `cluster_id`).

Do not put chart-only RDF/MSD into the pipeline. Do not put full dual forms on
both left and right.

## 2026-08-11 — empty pipeline default (no Empty Scene row)

1. Open / reset: **empty pipeline** + System length-1 empty trajectory.
   Composition with zero sources → empty Frame. UI: silent dashed open zone
   (no “empty pipeline” caption); + menu is **Open… / Add source… / Stream…**.
2. Data sources display as type name **Source** / **Stream**; filename is
   subtitle / body meta only. Properties first line = `modifier.name`.
3. Replace installs primary; augment stacks. Last DS removed → empty again.
4. Sketch/optimize commit creates a memory primary when none exists.
5. Implementation: `bootstrapEmptyPipeline` in `empty_scene.ts`.

Do **not** reintroduce loaders or demos that `pipeline.clear()` without
reinstalling a primary, or `setTrajectory` paths that leave the pipeline empty.

## 2026-07-30 — package naming lock

- Shared molrs gateway: **`core/`** → `@molcrafts/molvis-core` (transitive publish).
- 2D: **`sketch/`** → `@molcrafts/molvis-sketch`.
- 3D: **`stage/`** → `@molcrafts/molvis-stage`.
- Umbrella: **repo root** `@molcrafts/molvis` (thin `src/` re-exports only).
- Hosts (page, vsc-ext) import package names only — no `../stage/src` paths.
- Full matrix: [package-architecture.md](./package-architecture.md).

## 2026-07-30 — sketch chrome is package-owned (`gui` flag)

- Icon tool rails (top common · left chem · bottom assoc) live in
  **`sketch/src/ui/SketchComposer`**, not only in a host reimplementation in page.
- **`gui: true` (default)** mounts chrome; **`gui: false`** is canvas-only /
  host-owned chrome — same idea as stage's `gui` flag.
- Fragment templates (structure-diagram previews, nested category menu) are
  part of that chrome + engine (`fragment` tool, catalog, place command).
- `page` `MolvisSketch` is a thin React host: `new SketchComposer({ gui: true })`
  plus pop-out / generate-3D via **`extraSlot` portal** (no absolute overlay).
- **Theming:** sketch UI colors are tokens only
  (`sketch/src/style/tokens.ts` → `--msk-*`). Chrome CSS defaults and
  canvas theme (`background`/`bondStroke`/`labelFill`/`selectionStroke`)
  all resolve from those vars; page maps the full set in
  `.molvis-sketch-host`. No hard-coded hex in board/renderer/composer.
  Heteroatom ChemDraw labels (`SKETCH_ELEMENT_COLORS`) stay scientific
  data, not product UI tokens. Do **not** rewrite rails in shadcn for
  style parity.

## 2026-07-30 — stage context menu product tokens

- Context menu WCs (`molvis-context-menu`, button/folder/slider/separator) use
  shared `--molvis-ui-*` tokens (shadow DOM inherits from `.molvis-root`).
- Standalone defaults live in `SHARED_CSS` fallbacks (dark gun-metal).
- Page maps popover tokens in `tailwind.css` on `.molvis-root` — same bridge
  pattern as sketch; do not reimplement the menu in React/shadcn.

## 2026-08-10 — typecheck gate covers tests (core, stage) — remaining holes

- `core/` and `stage/` `npm run typecheck` now run `tsc --noEmit -p
  tsconfig.test.json` (extends `tsconfig.json`, `include: ["src", "tests"]`).
  Build/dts programs still read `tsconfig.json` (core rslib dts) or
  `tsconfig.build.json` (stage) — keep those src-only.
- 75 pre-existing test type errors were fixed when the gate widened; the gate
  is load-bearing now — a type error in any core/stage test fails CI.
- **Closed 2026-08-13:** `page/` and `sketch/` `typecheck` now run
  `tsc --noEmit -p tsconfig.test.json` (src + tests). Remaining hole:
  `vsc-ext/` still excludes `rslib.*.config.mts`.

## 2026-08-13 — Box.lengths / getBlock free (closed)

- **LAMMPS cell:** `stage/src/io/box_lammps.ts` is the one conversion.
  `Box.lengths()` is vector norms; recover `lx ly lz` from `hMatrix()`
  diagonal when tilted. Used by normalize_coords, DrawBox editor,
  optimize `describeCell`, analysis snapshot.
- **getBlock borrows:** `copyAtomColumns` / `copyBondColumns` never free
  the Block. Same rule applied in optimize relax/structure and neighbor_list.
- **Volumetric grids (accepted, not a bug):** CHGCAR/CUBE stay on the
  file box + periodic MC. Coordinate policy does not rewrite grids;
  isosurface already places voxels with `box.hMatrix()`.

## 2026-08-14 — worker-catalog-dispatch chain rules

<!-- mol:note:topic:analysis-ids -->
- **Catalog id constants:** `*_ANALYSIS_ID` constants are declared only in
  `stage/src/analysis/analysis_ids.ts` (zero-import Wire module). No file under
  `stage/src` spells a raw molrs catalog id string (grep-guarded by
  `regressions/worker-catalog-dispatch-01-seams.ts`). Page display/doc lookup
  tables (`useAnalysisCatalog.ts`, `molpy-docs.ts`) keep literal record keys on
  purpose — those keys are data, not dispatch identity.
<!-- mol:note:topic:acronyms-first-use -->
- **Acronyms:** always uppercase, and expanded once at first use in each file
  (MSD, RDF, VACF, WYSIWYG, LAMMPS…); bare afterwards. Established practice in
  `worker_protocol.ts` / `analysis_ids.ts`.
<!-- mol:note:topic:test-helper-duplication -->
- **Per-file test helpers:** small (<10-line) helpers like the `rejection()`
  await-reject wrapper are deliberately duplicated per test file — test
  self-containment (tests mirror source, own tests only) beats DRY here. Do not
  extract a shared test-utils module for them.

<!-- mol:note:topic:dtype-float-dispatch -->
## [2026-08-15] Block.dtype() 浮点分派必须同时接受 f32 与 f64

molrs `Block.dtype()` 对浮点列返回 "f32" **或** "f64"（molrs.d.ts:181/:197，文档在案的
API 面）。只匹配 `DType.F64` 的分派在 f32 构建下会**静默跳过**整列（charge 丢失即此病，
optimize-staging-02 修复了 cloneAtomColumns 的这只）。

**Rule**: 任何按 `Block.dtype()` 分派浮点列的代码必须同时处理 `DType.F32` 与 `DType.F64`，
绝不 F64-only。**已知欠账**：全仓约 25 处 F64-only 站点（11 个文件：bond_column_remap、
entity_source、DeleteSelected/ColorByProperty/Replicate/FreezeProperty/HideSelection/
HideHydrogens/VectorField 诸 modifier、source_composition、data_inspector）——数据完整性
sweep 单独立项（/mol:spec 或 /mol:debug），不做卫生级零敲。

<!-- mol:note:topic:optimize-staging-followups -->
## [2026-08-15] optimize-staging 链尾路由（未做，点名不静默）

- **导出路径仍丢列**：`commands/frame.ts` ExportFrameCommand（docstring 声称已修但不传
  sourceFrame——文档撒谎级）与 `io/writer.ts` exportFrame（无源帧入口，修复=签名变更）
  → 独立 spec。
- **面板统计读 HEAD**：暂存结果（尤其 +H）在 Ctrl+S 前不在 HEAD，面板原子/键计数与
  尺寸评估描述的是优化前结构 → 产品决策后另立条目。
- **两个编排入口逐环生长**：`job_runner.runOptimizeJob` 264 行 / `structure.runOptimize`
  157 行（默认上限 80）。要么捕获显式例外，要么在下一次触碰前 /mol:refactor 拆分。
- **regressions/*.ts 无门执行**（两仓同病）：无 CI/pre-commit/脚本引用，只靠人工跑。
  按「package.json 一行接 CI + pre-commit」的家规接线 → /mol:ci-sync。
- **大型结构 fake 逐文件复制**（SceneIndex/Artist 级整协作者 stand-in，80-130 行/份）：
  超出「<10 行助手可复制」的既载规则字面；要么放宽规则明文涵盖，要么抽
  tests/support/ 共享 fake → 操作者定夺。
