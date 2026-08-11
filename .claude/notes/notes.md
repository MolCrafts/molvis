# Notes

Passive memory for MolVis. `/mol:note` syncs decisions here; every agent reads
recent entries for context.

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

**Users never hand-build query strings:** Link/share dialog, toolbar Share, and
Settings → App & sharing call `buildShareUrl` / `resolveOpenInput`.

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

## 2026-07-30 — single scene path (Empty Scene always)

**Invariant — form and path are unique.**

1. Open / reset always has a **length-1 trajectory** on `System` and **≥1
   DataSourceModifier** at the pipeline head (primary = Empty Scene memory
   source: `sourceType: "empty"`, filename `"Empty Scene"`).
2. There is **no** parallel “no DS / paint without composition” mode.
3. Every ingress operates on that path:
   `DataSource(s) → compose → transforms → draws`.
   - File **replace** → sole primary DS + System share the loaded trajectory.
   - File **augment** → additional DS; primary never disappears.
   - Sketch / edit **commit** → write frame into primary trajectory HEAD.
   - Manual box / Wrap PBC / analysis → read/write working `frame` from
     composition (manual box writes `frame.box`).
4. Removing the last DS reinstalls Empty Scene (never zero sources).
5. Implementation: `stage/src/pipeline/empty_scene.ts`, boot via
   `SceneSession.bootstrapEmptyPrimary()` in `MolvisApp` constructor + `reset`.

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
- **Open holes (follow-up work, not yet gated):**
  - `page/`, `sketch/` tsconfigs still `include: ["src"]` — their tests are
    outside every typecheck lane.
  - `vsc-ext/` explicitly excludes `rslib.*.config.mts` (incl. the shared
    `rslib.webview.worker-rewrites.mts` helper) — build configs are typed only
    by rslib's config loader at build time.

## 2026-08-10 — open correctness items found during workload-analysis-jobs

- **`stage/src/io/normalize_coords.ts:134-146` unscales triclinic fractional
  coords wrong**: it mixes `box.lengths()` (cell-vector norms) with
  `box.tilts()` — for nonzero `xy` the y-unscale is off (~3% on an 8Å/2Å-tilt
  cell). Ortho unaffected. Route: `/mol:fix` with a scaled triclinic LAMMPS
  dump RED fixture. Convention reminder: molrs `Box.lengths()` ≠ LAMMPS
  diagonal for tilted cells; pair `hMatrixFromLammps(diagonal, tilts)`.
- **`stage/src/optimize/job_runner.ts` (`readXyz`/`readBonds`) frees
  `getBlock` borrows via `safeFree`** — molrs handle rules forbid freeing
  borrows; today it survives only because `safeFree` swallows the throw.
  Route: `/mol:debug` to pin the actual molrs borrow semantics, then delete
  the frees or make the ownership explicit.
- **Same norms-vs-diagonal bug, third site:**
  `page/src/ui/modes/view/modifiers/DrawBoxModifier.tsx:32` `defaultManualBox`
  pairs `box.lengths()` (norms) with `box.tilts()` → the Simulation-cell editor
  shows/commits an inflated `ly`/`lz` on tilted cells and deforms the cell on
  apply; also carries a defensive try-catch (lines 35-48) against the
  no-defensive-catch rule. Route with the normalize_coords fix — one
  `/mol:fix` sweep for the `Box.lengths()` convention family.
