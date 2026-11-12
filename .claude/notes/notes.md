# Notes

Passive memory for MolVis. `/mol:note` syncs decisions here; every agent reads
recent entries for context.

<!-- mol:note:topic:no-regressions-lane -->
## [2026-09-20] No regressions / e2e / golden-lock lane

**Rule**: unit tests only under `*/tests/`, one module, its own tests.
There is no repo-root `regressions/`, no e2e lane, and no source-text
golden-lock scripts. Since 2026-10-08 there is no browser mode either: no
`@rstest/browser`, no Playwright; every suite runs in plain Node. Python↔TS RPC catalog parity stays in
`python/tests/test_wire_parity.py` (the unique unit of that seam).

**Supersedes**: `.claude/notes/package-architecture.md` 2026-08-14
“sanctioned golden-lock lane”.

<!-- mol:note:topic:mrec-ingest -->
## [2026-09-03] mrec ingest: reader in the worker, index-driven changeKind

**Where the reader lives.** molrs `TrajectoryReader` opens every `*.mrec`
store — the directory and the packed `*.mrec.zip` (`isMrecZipPath`, never a
`FileFormat`). With Workers it lives in the trajectory worker (`Format`
`"mrec"`; `worker.ts` `openStore` / `loadStoreFrame`; `streams.ts`
`MOLRS_STORE_READERS`): the host posts the store once and never sees store
bytes again. Without Workers the sync provider (`io/zarr.ts` `loadMrecInput`)
opens it on the main thread. Single ingress: every host door →
`loadMrecSource` (`io/index.ts`) → `commitLoadedTrajectory`; the
`Record` branch of `loadFileContent` routes there too. `core/src/molrs.ts`
types the store host (`MrecStoreHost`, `openMrecStore`); nothing else imports
`@molcrafts/molrs`.

**What crosses into wasm.** Only touched byte ranges — every array is
sharded with its index at the start, and the reader asks for ranges through
the host's `getRange`. Three store shapes (`MrecStoreInput` →
`MrecSourceHandle`, `io/mrec_stream.ts`):

- `files` / `mrec-files` — whole store in memory, transferred once (sender's
  buffers detach), opened through `MapMrecStoreHost` (`fromStore`; never the
  copying `new TrajectoryReader(map)`).
- `file-tree` / `mrec-file-tree` — browser `File` handles; the worker's
  `FileTreeMrecStoreHost` reads exact ranges with `FileReaderSync`. This is
  the lazy path (page directory picker / dropped folder,
  `page/src/lib/mrec-open.ts`); nothing but touched chunks leaves disk.
- `zip` / `mrec-zip` — read whole by the host, transferred, `fromZip` in the
  worker (stored entries only).

Frames return as `FrameMessage` via `encodeFrame` (the worker frees its Frame
at once); numeric `meta` and `sectionUpdates` ride along.

**Index-driven classification.** Every molrec section (atoms too) is a CSR
update list and bit-identical content earns no update. Seam:
`FrameProvider` / `AsyncFrameProvider.sectionUpdates?(i)` →
`Trajectory.sectionUpdates(i)` (block → update id; dark for replaced slots,
composed / remapped wrappers, byte streams). `classifyFrameTransition(prev,
next, { previous, next })` answers `"position"` when every non-atoms block id
is unchanged — the O(N) element and O(M) bond compares are skipped — and
`"full"` when a topology block id changed or a block appeared / disappeared.
The O(1) atom-count and the occupancy guards still run first. `app.ts` keeps
`_lastRenderedIndex` beside `_lastRenderedFrame`; any non-trajectory render
nulls it. Pinned assumption: an atoms update moves coordinates, not identity
columns — a store that rewrites `element` per frame must replay with Create
bonds on. The `changeKind` contract in `CLAUDE.md` is unchanged.

**VS Code.** The webview↔host channel is async and the reader's key host must
answer synchronously inside the worker (no COOP/COEP in webviews, so no
`Atomics.wait` bridge either), so vsc-ext keeps the transfer-once `Record`
path (`readZarrDirectoryWithFs`, 1 GiB cap stays) — the webview now hands that
map to its worker — and gains `.mrec.zip`. Do not invent a blocking bridge.
Pinned by `stage/tests/io/formats.test.ts` (`isMrecZipPath`, mrec is not a
`FileFormat`).

<!-- mol:note:topic:files-tree-lazy -->
## [2026-09-06] The Files tree reads one directory at a time, and honours .gitignore

**Rule**: `molvis.files` never walks the workspace. `getChildren` does exactly
one `workspace.fs.readDirectory` for the node it was asked about — the root on
open, one more per disclosure triangle — and nothing looks below the node it
was given. There is no scan, no cache and no "scanning" state to get stuck in.

**Why**: it used to `await` a full `findFiles` pass over 12 globs before it
could draw its first row. `findFiles` costs a directory walk per *pattern*, and
the exclude list omitted `target/` (~35k files in molrs alone) and `.conda`
(~77k); on Lustre one walk measured 8.6 s, so twelve of them meant the tree
never rendered. The user saw the empty-state welcome ("No molecular files in
this workspace") over a spinner, and — because VS Code paints a progress badge
on the container icon while a view is loading — an activity-bar icon that
looked like it had failed to load. One cause, three symptoms.

**Filters, in order**: `IGNORED_DIRECTORY_NAMES` (generated trees: `target`,
`.conda`, `site-packages`, `.cache`, `__pycache__`, `build`, …) then
`.gitignore` (`loading/gitignore.ts` — git's pattern language, last match
wins, nested files govern their own subtree, rules inherited down the path on
the node). A directory the user already told git to forget has no business in
a file picker. `IGNORED_DIRECTORY_NAMES` and `WORKSPACE_FILE_EXCLUDE` are one
list in two shapes and a test pins them equal.

An `*.mrec` directory is a leaf, not a folder to walk into.

Code: `vsc-ext/src/extension/panels/filesView.ts`,
`vsc-ext/src/extension/loading/{gitignore.ts,molecularMatch.ts}`.
(`loading/filesTree.ts` went with the scan.)

<!-- mol:note:topic:mrec-record-shapes -->
## [2026-09-06] A `*.mrec` record is a package; opening one as a trajectory is a guess

**Rule**: sections are independent and **coexist**. The ingress reads the key
set — `frame/atoms/x/zarr.json` says `frame`, free, nothing parsed — and opens
what is there: a `trajectory` as the streamed sequence, a `frame` as a
length-1 source beside it. A run that writes the topology once and the
coordinates every step therefore composes back together the way LAMMPS data +
DCD already do, without the user opening two files. Neither section present →
refused **by name**.

**Reading one section must not decode the others.** `read_record_store` decodes
everything it finds, trajectory included, so it is the wrong door for "give me
the topology out of this run". molrs grew `read_frame_section_store` /
`section_names_store` for that; wasm's `readMrecFrame` uses the former.

**Order is load-bearing.** Opening the sequence hands the store's buffers to
the worker in a **transfer list**, which detaches them — anything else the
record carries must be read *before* that or not at all. The first cut of this
fix read the snapshot only after the sequence failed and died on
`Cannot perform Construct on a detached or out-of-bounds ArrayBuffer`.

**Why any of it**: molpack writes a packed configuration with `write_frame`, so
`pack_peo_linear.mrec` carries `frame` and no `trajectory`. molvis opened every
store through `TrajectoryReader`, and molrs documents that a store with no
`trajectory` section reads as an **empty** `Trajectory`, not an error
(`read_trajectory_file`). The file opened, drew nothing, and said nothing. The
molrs behaviour is deliberate and stays; the consumer asks what it got.

Code: `molrs/src/io/zarr/record_io.rs` (`read_frame_section_store`,
`section_names_store`), `molrs-wasm/src/io/zarr/mod.rs`, `core/src/molrs.ts`,
`stage/src/io/mrec_stream.ts` (`mrecStoreGroups`, `readMrecFrameSection`),
`stage/src/io/index.ts` (`loadMrecSource`, `addMrecFrameOverlay`).

<!-- mol:note:topic:mesh-overlay -->
## [2026-09-06] STL is view geometry, never a data source

**Rule**: an `*.stl` triangle mesh carries no atoms, no cell and no frames, so
it is not a `FileFormat` and never becomes a `DataSource`. Hosts recognise it
with `isStlPath` and hand the bytes to `loadMeshOverlay` (`io/index.ts`), which
adds a `Mesh` (`MeshOverlayModifier`) plus the `Draw surface` companion that
`addModifier` pairs with every geometry producer. The load is additive and has
no `LoadMode`: dropping a mesh never clears the scene, never touches source
composition, and never prompts the unsaved-edits dialog.

Because its triangles come from the file and not from the frame, every
pipeline pass republishes the **same array**, so the mesh simply stays on
screen while the trajectory plays inside it. `Draw surface` keys a
skip-rebuild on exactly that array identity (plus `layer.hasData`, since
`artist.clear()` drops surface layers without telling it) — a producer that
recomputes hands back a new array and still repaints as before.

**molrs owns the parse.** `molrs::io::mesh::stl` reads STL into a
`molrs::spatial::TriMesh`; wasm exposes it as `readSTL`, and
`core/src/molrs.ts`'s `readStlMesh` copies the arrays out and frees the handle
before returning, so no mesh handle ever reaches the stage. molpack's
`StlRegion` reads the same files through the same reader, so the container a
packing run is confined to and the container molvis draws cannot drift apart.
Length-matched binary first (`84 + 50n`), otherwise ASCII `solid`; normals from
the winding, because molpack writes `facet normal 0 0 0`.

This does not reopen `PipelineContext.surfaces`. A *file* mesh crosses wasm
once, at open. A *computed* surface (marching cubes, molecular surface) is
re-derived every pipeline pass and still stays in JS.

Geometry is not saved into a project (it is file bytes, not parameters); a
restored `Mesh` row keeps `sourceName` and paints nothing until the file is
opened again. `World.fit` falls back to surface-layer AABB corners so an
STL-only scene still frames.

Both hosts route `.stl`: the page through `loadFileSmart`, vsc-ext through the
host loader (raw bytes, no format picker), the webview `loadFile` message, its
drop handler, and the `molvis.binaryEditor` custom editor — STL sits with the
binary trajectories there because the extension does not say which half of the
format a file is, and reading bytes is right for both.

Code: `molrs/src/{core/spatial/mesh.rs,io/mesh/stl.rs}`,
`molrs-wasm/src/{core/mesh.rs,io/mesh.rs}`, `core/src/molrs.ts`,
`stage/src/io/stl.ts`, `stage/src/pipeline/mesh_overlay.ts`,
`stage/src/pipeline/draw_surface.ts`, `page/src/components/format-picker-dialog.tsx`,
`vsc-ext/src/{extension/loading,webview}`.

<!-- mol:note:topic:stage-self-reference-dts -->
## [2026-09-07] stage's package self-references resolve through a `source` condition

**Rule**: the two specifiers inside `stage/src` that name their own package —
`@molcrafts/molvis-stage/worker-spawner` and `.../trajectory-runtime`, the
seam host builds alias to swap worker spawning — resolve for type-checking
through a `"source"` condition in `stage/package.json` `exports`, selected by
`customConditions: ["source"]` in `stage/tsconfig.json`.

Why not the obvious fix: `exports` sends type resolution into
`dist/**/*.d.ts`, which the declaration build is in the middle of emitting and
`cleanDistPath` has just deleted — so `npm run build` always exited 1 with
`Cannot find module '@molcrafts/molvis-stage/trajectory-runtime'` (plus two
implicit-`any` errors falling out of it). Plain `tsc` only passed because a
previous build had left `dist` on disk.

**Do not use tsconfig `paths` here.** It resolves, but rslib rewrites path
aliases in the emitted declarations (`output.redirect.dts`), turning the
package specifier into `../transport/trajectory_worker/runtime.ts` — a `.ts`
file that does not exist in `dist`, and a monorepo-relative path the rslib
config explicitly forbids. A resolution condition leaves the written
specifier alone, so consumers keep resolving through `exports`.

Check it stays fixed by deleting `dist` entirely and running
`tsc --noEmit -p tsconfig.test.json`: the point is that the typecheck no
longer depends on `dist` existing.

Code: `stage/package.json` (`exports` `source`), `stage/tsconfig.json`,
`stage/rslib.config.ts`, `stage/src/io/index.ts` (the seam's own comment).

<!-- mol:note:topic:dump-local-bond-mapping -->
## [2026-09-07] `dump local` column names are the user's, not ours

**Rule**: a LAMMPS `dump local` file's column names carry no meaning by
default, so molvis follows OVITO's reader rather than inventing a convention.
Two signals promote a local block to `bonds`, either alone being enough:

1. **The section label.** `dump_modify … label BONDS` is what OVITO's manual
   tells users to set. molrs accepts `ENTRIES` (the LAMMPS default) plus
   `BONDS` / `ANGLES` / `DIHEDRALS` / `IMPROPERS` / `NEIGHBORS`, and records
   which one in frame meta as `dump_local_label`.
2. **Recognised endpoint columns** — `matchBondEndpointColumns`, which is
   OVITO's alias set: `batom1`/`batom2` (the `compute property/local`
   attribute names, restored by `dump_modify … colname`) and OVITO's own
   standard-property spelling `ParticleIdentifiers.A`/`.B`. Case-insensitive.

Anything else — and the default `dump local c_bond[1] c_bond[2]` header is
exactly that, three columns saying nothing — reaches the user through
`pickBondMapping`. **Never guess there**: a wrong endpoint mapping draws wrong
topology in silence. This is OVITO's rule too.

Why it matters: the mapping decides whether `DrawBondModifier` is attached at
all (`attachBondMappingChildren`) — `DrawBondModifier.matches` refuses a bonds
block without `atomi`/`atomj`, so nothing else can attach it. Both signals
were missing once, and each failure was silent: `ITEM: NUMBER OF BONDS` was a
hard parse error, and a default-named file sat in `entries` forever — no bonds
block, hence no prompt, hence a drop that appeared to do nothing.

**Picker fallback chain**: host-supplied `pickBondMapping` → the stage's own
`molvis-bond-mapping-dialog` (via `GUIManager.pickBondMapping`, gated on
`canPrompt`) → a `status-message` warning naming the columns. The page uses
its React dialog; the `molvis-viewer` element and the VS Code webview use the
stage's; only a headless / `showUI: false` app is left without one.

**After load**, the mapping is a `BondColumnRemapModifier` in the pipeline;
the page's panel for it is where an inference is read back and corrected. Its
endpoint candidates come from the owning source's `cachedFrame`, never the
composed frame — the composed one has already been remapped and would offer
`atomi`/`atomj` back as sources.

**String frame meta crosses the worker.** `dump_local_label` is a word, and
the trajectory-worker frame codec used to carry numeric meta only
(`getMetaScalar`), so the label vanished on the streaming path (files ≥16 MB)
while the whole-file path kept it. `FrameMessage.metaText` carries it now.
`Frame.getMeta` (molrs-wasm) is the string counterpart of `setMeta`, added for
this; it deliberately does not stringify numeric meta.

Reference: <https://www.ovito.org/manual/reference/file_formats/input/lammps_dump_local.html>

Code: `molrs/src/io/trajectory/lammps_dump.rs` (`LOCAL_LABELS`),
`molrs-wasm/src/core/frame.rs` (`getMeta`),
`stage/src/io/formats.ts` (`matchBondEndpointColumns`),
`stage/src/io/reader.ts` (`normalizeDumpLocalEntries`),
`stage/src/pipeline/bond_column_remap.ts`,
`stage/src/io/index.ts` (`maybePromptBondMapping`),
`stage/src/ui/dialogs/bond_mapping_dialog.ts`, `stage/src/ui/manager.ts`,
`stage/src/transport/trajectory_worker/frame_codec.ts`,
`page/src/components/bond-column-mapping-dialog.tsx`,
`page/src/ui/modes/view/modifiers/BondColumnRemapModifier.tsx`.

<!-- mol:note:topic:drop-augment -->
## [2026-08-19] Drop onto a loaded scene stacks sources

**Rule**: Explorer / canvas drop uses `dropLoadMode(sourceCount)`:
empty pipeline → `replace`; already-has-sources → `augment`. Topology
(LAMMPS `.data`) and trajectory (DCD/XTC/TRR) compose in either order:
coords from the N-frame source, identity/bonds from the length-1 source.
Align atom rows by `id` (LAMMPS data is file-order; DCD is id-order) —
never overlay xyz by row index or bonds explode.
A length-1 FileDataSource is broadcast, not “1-frame traj that must match N”.
System follows the longest FileDataSource.

Code: `stage/src/io/formats.ts` `dropLoadMode`,
`stage/src/system/source_composition.ts`, `vsc-ext` / `page` drop handlers.

<!-- mol:note:topic:molrs-identity-convention -->
## [2026-08-20] molrs and molvis share one atom-identity convention

**Rule**: an atom's identity is the molrs `id` column (u64 / Idx — molrs
`Block::insert` pins that key; rows stay in read order, not id order). molvis
consumes molrs data as-is: reads never reindex ids, and any file that names
atoms — the mask file in particular — stores those `id` values verbatim. No
id↔row-index conversion crosses the molrs/molvis boundary. A row-indexed
`SelectionMask` is a molvis render artifact built only at apply time by
looking ids up in the frame's `id` column; unknown ids are a loud error.
WASM `setColU32` / `copyColU32` / `viewColU32` keep those JS names but take
and return `BigUint64Array`. GPU meshes, CSR tables, and display-row maps
stay `Uint32Array`.

Code: `stage/src/selection/mask_file.ts`,
`stage/src/modifiers/SelectMaskModifier.ts`,
`stage/src/pipeline/bond_column_remap.ts`,
`stage/src/system/source_composition.ts`.

<!-- mol:note:topic:webview-worker-wasm -->
## [2026-08-19] VS Code trajectory worker WASM is posted, never fetched

Webviews are `vscode-webview://`; `asWebviewUri` scripts live on
`*.vscode-cdn.net`. Three Chromium traps, all observed:

1. `new Worker(cdnUrl)` is a cross-origin constructor — rejected.
2. Blob-module **static** `import` of the CDN worker loads JS, but the
   worker's `fetch(*.module.wasm)` is CORS / CSP `connect-src` and throws
   `Failed to fetch`. Redirecting that fetch to a `blob:` wasm URL still
   fetches.
3. Blob-module **dynamic** `import(cdnUrl)` is itself a fetch —
   `Failed to fetch dynamically imported module`. Static `import` is
   hoisted, so it cannot run after a wasm handshake.

**Rule**: Main thread `fetch`es worker.js + wasm via `asWebviewUri`. Spawn a
blob worker whose prefix waits for `{__molvisWasm: ArrayBuffer}`, serves
`.module.wasm` with `new Response(bytes)` (and patches
`WebAssembly.instantiateStreaming`), then **inlines** the worker source in
the same module. No worker-side `import()`, no worker-side wasm `fetch`.
Handshake is `__molvisWasmWant` first — Chrome drops messages posted before
the worker script starts. Bump `WEBVIEW_ASSET_REV` in `html.ts` when this
bootstrap changes. `connect-src` / `worker-src` must allow `blob:`.

Code: `vsc-ext/src/webview/spawnWebviewWorker.ts`.

<!-- mol:note:topic:molrs-traj-streaming -->
## [2026-08-18] MolRS owns trajectory streaming

**Rule**: Frame boundary + one-frame decode live only in MolRS (`Wasm*Stream` /
successors). MolVis hosts supply `readRange`. Never reimplement ITEM:TIMESTEP /
XYZ-N / DCD stride in page, vsc-ext, or Python. DCD/XTC/TRR streaming is a
MolRS acceptance bar, not a molvis parser. SSH/HTTP/DataSource are molvis-only.

**Supersedes**: traj-ingest-05 draft of a JS `TrajectoryBoundaryIndexer`.

<!-- mol:note:topic:datasource-no-kind -->
## [2026-08-18] DataSource has no kind

**Rule**: Subclasses convert a source into `Trajectory`/`Frame`. Branch with
`instanceof`. Do not add `DataSourceKind` members (`ssh`/`http` were deleted
and stay deleted). Those transports are not MolRS types.

See spec `traj-ingest-06-source`.

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

## 2026-08-21 — Single wrap gate (proposal C)

- **pbc-wrap-single-gate:** `wrapEnabled` boolean after compose → one
  `wrapAtoms` / `Box.wrap` on atom columns. UI entries (Simulation cell
  Switch, pipeline Add menu, View canvas context menu) all toggle the
  same flag — not a second Wrap modifier path. Retired: four-value
  `CoordinatePolicy`, `wrap-molecules`, `WrapPBCModifier`. Edge bonds =
  draw-time MI only.
- Unwrap trajectories stays Add-menu modifier (not a wrap state).

## 2026-08-11 — Series first-class + post-policy MI audit

- Time/transport series: product labels in Compute picker; Generic panel
  Cancel (abort) + "No series yet"; ResultView knows lagTimes/msd/vacf fields.
- Draw MI audit: ribbon/bond comments + `wrap_locality` test — full `Box.wrap`
  only under `coords/wrap.ts`; MI delta is draw-only on post-policy frames.
- OVITO parity: time series / bond distributions marked done.

## 2026-08-11 — Coordinate policy + Rings compute

- **coordinate-frame-policy (superseded 2026-08-21):** originally four-value
  policy + WrapPBC; see **pbc-wrap-single-gate** above for the current rule.
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

**Amended 2026-08-28 — surfaces use a producer + draw pair instead.**

Rules 2 and 3 split one modifier's form across two panels. Surfaces now split
the *modifier*: a `ProducesGeometry` step publishes `SurfacePart[]` and carries
its own `Draw surface` entry (`stage/src/pipeline/draw_surface.ts`), the way a
DataSource carries Particles and Bonds.

- Producer panel: `usesLeftConfig: true`, `surface="compute"` only. Algorithm
  and its parameters, nothing about appearance.
- `Draw surface` is a **separate pipeline row** owned by the producer
  (`sourceOwnerId`), so it nests under it in the tree and dies with it. Its
  panel is plain (no `usesLeftConfig`): colour, opacity, finish.

Why the pair beats the two-panel form here: a seventh surface algorithm becomes
one producer and no rendering work, two surfaces in one scene can be coloured
and hidden apart, and appearance stops re-running the algorithm — for alpha
shape that is a Delaunay tetrahedralisation per colour change.

Anything that computes geometry a shared renderer can paint should follow this.
The two-panel form stays correct for modifiers whose "draw" is not separable
(Vector field, Coordination polyhedra, Trajectory lines own their overlays).

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

**Rule**: 任何按 `Block.dtype()` 分派浮点列的代码必须走 `isFloatDtype()`（类型谓词，
`stage/src/utils/dtype.ts`），绝不 F64-only。**欠账已清（2026-08-16）**：28 处站点
（11 文件）全部换写；data_inspector 的描述符保真（`dtype: dt` 而非硬写 F64）、
source_composition 的词表守卫同步拓宽。实证注记：当前 molrs 构建**运行时纯 f64**
（浮点宽度是编译期选择，JS 侧造不出 f32 列）——sweep 是前瞻加固；可运行时验证的面 =
helper 单测 + data_inspector（分派调用方传入的 dtype 串）；entity_source/ColorByProperty
无 dtype 缝，正确性由「必经 isFloatDtype」构造保证，未做覆盖表演。

<!-- mol:note:topic:optimize-staging-followups -->
## [2026-08-15] optimize-staging 链尾路由（未做，点名不静默）

- ~~导出路径仍丢列~~ → **已清（2026-08-16）**：ExportFrameCommand 传 `app.frame`；
  `WriteFrameOptions` 增可选 `sourceFrame`（非破坏）。测试钉住 charge(浮点)+mol_id(u32)
  两形（白名单形缺陷，非浮点形），mol2 的 USER_CHARGES 文本级断言。
- **面板统计读 HEAD**：暂存结果（尤其 +H）在 Ctrl+S 前不在 HEAD，面板原子/键计数与
  尺寸评估描述的是优化前结构 → 产品决策后另立条目。
- **两个编排入口逐环生长**：`job_runner.runOptimizeJob` 264 行 / `structure.runOptimize`
  157 行（默认上限 80）。要么捕获显式例外，要么在下一次触碰前 /mol:refactor 拆分。
- ~~regressions/*.ts 无门执行~~ → **已清（2026-08-16，两仓同修）**：molvis
  `check:regressions` 一行脚本接入 CI build-core 步骤 + pre-push 钩子（db3e179，
  17/17 verified）；molrs 侧 .mjs 回归进 pre-push wasm 钩子 + ci-wasm，.py 回归进
  ci-python（35acac9）。
- ~~大型结构 fake 逐文件复制~~ → **已裁决（2026-08-16）**：整协作者级结构 fake
  （SceneIndex/Artist/CommandManager stand-in，80-130 行/份）与 <10 行助手同规——
  **逐文件复制是入册惯例**，不抽 tests/support/ 共享模块。理由同源：单测自持优先于
  DRY，共享 fake 让一处改动红一片、测试文件失去可拷贝文档性。fake 必须在忠实处
  忠实（updateAtom 合并 meta、markDirty 语义等 load-bearing 行为），其余从简。

<!-- mol:note:topic:activitybar-icon-remote-cors -->
## [2026-09-06] activity bar 图标在 Remote-SSH 下空白 —— 上游 bug，不要改 SVG

**症状**：activity bar 上按钮在、图标完全不可见。扩展正常激活
（`remoteexthost.log` 有 `_doActivateExtension molcrafts.molvis,
activationEvent: 'onView:molvis.files'`），视图能开，只有图标没了。

**根因（VS Code 上游，非本仓）**：`paneCompositeBar.ts` 的
`toCompositeBarActionItem()` 对文件路径图标生成
`mask: ${asCSSUrl(icon)} no-repeat 50% 50%`；`network.ts` 的
`uriToBrowserUri()` 对 `vscode-remote` scheme 走 `RemoteAuthorities.rewrite()`，
产出 `vscode-managed-remote-resource://host:port/...`，而 workbench 文档源是
`vscode-file://vscode-app` → 跨源被 CORS 拦 → 遮罩静默失败。
microsoft/vscode#319834（标称 1.124.0 修复，但 1.136.1 实测仍复现，
可能二次回归）。**只在 Remote-SSH/WSL/容器 下出现，本地窗口正常。**
与安装方式（marketplace vs vsix）**完全无关**——两者写入同一目录同一批文件。

**`contributes.icons` + 图标字体不是绕路**：`iconExtensionPoint.ts` 的
`joinPath(extensionLocation, fontPath)` 同样是远程 URI，
`iconsStyleSheet.ts` 又经同一个 `asCSSUrl` 进 `@font-face { src: ... }`，
一样被拦。实测：字形正确的 WOFF 装上去显示豆腐方框（字体没加载，回退字体
在 U+E001 无字形）。上游 issue 标题即 "icons/fonts (SVG/WOFF2) blocked by CORS"。

**裁决**：保留 `icon: "image/molvis-activitybar.svg"`。SVG 是正确产物，
本地与市场用户正常，上游修好后 Remote 自动恢复。唯一在所有环境可见的替代是
内置 codicon（`$(beaker)` 等，走 `ThemeIcon.asClassNameArray` 不取资源），
但要牺牲品牌，已否决。

⚠️ **不要为「图标空白」去改 SVG**。以下三条都试过、都无效：
改填充色（遮罩走 alpha，颜色被丢弃）；展平 potrace 的嵌套 `<g>`/transform
（展平后与原图 0 像素差异——不过展平本身作为清理保留了）；换图标字体（同墙）。
SVG 本身从来没问题：ImageMagick alpha 提取、Chromium 24px 遮罩均正常渲染。

---

## 编辑/绘制路径的四条规则（2026-09-17 bug 批次）

一批用户报告（删原子不删键、悬停按键无效、优化时键不动、切 edit 卡死）收敛到
四个所有权/路由问题。规则记在这里，别再各自重犯。

### 1. 拓扑的生命周期归「整趟重建」，不归任何一层

`SceneIndex.registerAtomFrame` 曾经自己 `topology.clear()`，注释假定
「原子层先跑、键层后补」。**绘制顺序由 pipeline 的 modifier 顺序决定**，而
auto-attach 实际是 Bonds 先于 Particles —— 于是每趟都是「键层建边 → 原子层清空」，
拓扑永远只有顶点没有边。`getBondsForAtom()` / `incident()` 全线返回空，
删原子不连带删键、优化时 `refreshBondsAround` 一根都刷不到。

`topology.clear()` 现在只在 `MolvisApp.applyPipeline` 的 `changeKind === "full"`
分支、任何 Draw 之前调用一次。**任何注册函数都不得重置拓扑**——层不知道自己
第几个跑。门：`stage/tests/scene_index.test.ts`「键层先于原子层注册时边必须存活」。

### 2. 按键从 document 路由，用 `:hover` 判定目标面

Babylon 的 `scene.onKeyboardObservable` **只在画布持有焦点时触发**，所以
「鼠标放到原子上按 Delete」在用户从未点过画布时完全无效。`BaseMode` 现在挂
document 级 keydown，用 `canvas.matches(":hover") || document.activeElement === canvas`
作门。**不要改回自维护的 `pointerenter/leave` 标志**：指针在模式挂载前就已在
画布内时该事件永不触发（真实场景：先把鼠标放上去、再切模式），实测失效。

### 3. 编辑池的 meta 是写时复制，删除用墓碑

`promoteFrameToEditPool` 曾把每个 frame 实体的 meta 复制进 edit map 再
`setFrame(null)`。500k 原子实测 **35.6 s（占 33–36 s 卡顿的 99.8%）**，索引表只占 81 ms。
复制是被 `setFrame(null)` 逼出来的：frame 源一空，`getAllIds()` 就只剩
`edits.keys()`，不复制就会在提交时丢掉所有未编辑实体。

现在保留 frame 源、不复制（`getMeta` 本就是 edit 覆盖→frame 回落，移动过的原子
经 `updateAtom` 自己产生 edit 条目），删除记进 `AtomSource.deleted` /
`BondSource.deleted` 墓碑集合。**没有墓碑，被删的原子会因为 frame 块里那一行还在
而在提交时复活**。promote 现在只做渲染侧索引表。`setMode("edit")`：33.6 s → 0.155 s。

### 4. 拓扑是否变了，由发生那趟的 `changeKind` 说了算

`frame-rendered` 现在携带 `changeKind`。消费端**不得**自己比行数来判断「拓扑变没变」：
等原子数的拓扑替换（同原子、不同键）行数完全一致，会静默服务陈旧结果——
vsc-ext 的 outline 缓存键 `nrows:nrows` 就是这么错的。引擎在 `applyPipeline`
已经做过这个判断，带着走即可，消费端 O(1)。

### 5. 两个 webview 无法共享已解析的 frame

Quick look 和 Page 是独立 webview，各有 JS 上下文与 wasm，解析结果在 wasm 线性
内存里，**无法移交**。所以「Quick look 开着 → promote 到 Page」必然二次传输+解析；
在 Remote-SSH 上那是过网。可做的只有：同一文件已在 Page 就不重发（已做）、
`molvis.defaultViewer: "page"` 让文件直接在 Page 打开从而不产生第一次（已做）。
宿主侧字节缓存**不值得**：本地读 78 MB 仅 ~40 ms，却要常驻同等内存。

<!-- mol:note:topic:regressions-lane-contract-drift -->
## [2026-09-17] `regressions/` 的成文契约与实况矛盾（待操作者裁定）

**发现**：`.claude/notes/package-architecture.md:78-86` 写明该 lane 的契约是
「import built `dist` output only (public barrel or deep path)」。树内实况不是
这样：

- `regressions/traj-ingest-04-range.ts:9-10` 同时 import `../stage/src/io/formats.ts`
  与 `../vsc-ext/src/extension/loading/molecularLoadIntent.ts` —— 两者都是 `src`，
  且 `vsc-ext` 是 private 包（无 `exports`，`main: ./out/extension.js`），
  根本没有可 import 的 `dist` 公开路径。
- 31 个脚本中有 **21 个**调用 `readFileSync` 断言源码文本，而不是执行公开 API。

**为什么这不只是文档问题**：条文被当作判据用过。`one-viewer-surface` 链条的
设计评审两次援引它否决新增脚本；第一次援引时把「lane 只准 dist」当成既定规则，
而那条规则与 lane 自身的内容不符。判决结论（那两个脚本确实不该加）站得住，但
理由必须换成实质性的那条：**断言源码文本的脚本不是闸**——字符串留存而行为被删时
它会通过，无关重命名时它会失败，违反 CLAUDE.md「每道闸必须被证明会咬人」。

**待裁定（操作者）**：二选一，不要两头模糊。

- **A**：lane 允许 import 仓内 `src`，条文照实况改写；同时明确「读源码文本」始终
  不算闸，那 21 个脚本里凡是只做文本断言的都是待偿的债。
- **B**：条文不变，`traj-ingest-04-range.ts` 等违例脚本是待修的债，需逐个改为
  执行公开 API 或删除。

在裁定之前，新链条一律**不新增** `regressions/` 脚本，契约由各包自己的单测持有
（`one-viewer-surface-01/02` 已按此执行，并在各自 spec 的 Testing strategy 中
写明理由）。
