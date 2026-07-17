# Spec: vsc-ext-surfaces

## Summary
Redesign the VSCode extension's webview entry points into three clearly-named
surfaces — a lightweight **Quick View** (molvis-core canvas) for peeking at a
file, a persistent **MolVis** activity-bar view hosting the full React page, and
a **page surface/flag system** that lets one page codebase render as either the
full app or a slimmed variant. Removes the current naming overload
(`editor`/`quickView`/`workspace`/`standalone`/`app` → only two real UIs).

## Motivation
Opening a molecular file today is confusing: the editor title bar only exposes
"Quick View" (the light canvas), while the full React page ("Open in Editor") is
buried in the explorer right-click menu, and the two are named inconsistently
(the `molvis.editor` custom editor's displayName is literally "MolVis Quick
Preview"). There is no persistent home for MolVis — it is purely file-contextual.

This redesign gives each experience a distinct, discoverable home and follows one
principle: **let VSCode own what VSCode is good at (file navigation, tabs), and
don't duplicate its chrome inside a webview.** The page flag system is the
foundation that later enables a native Structure Outline tree and VSCode-explorer
integration without another rewrite.

## Scope
- **In scope**:
  1. **Quick View surface** — formalize the existing light-canvas preview
     (`molvis.quickView` command + `molvis.editor` custom editor, both →
     `getPreviewHtml` → core canvas). Naming cleanup only; no behavior change.
  2. **Activity-bar MolVis surface** — a new `WebviewViewProvider` in a new
     activity-bar view container that hosts the full React page bundle, with
     `retainContextWhenHidden: true`. Includes a monochrome themable SVG icon.
  3. **page surface/flag system** — generalize the existing `MountOpts.minimal`
     into a `surface` preset (`"full" | "canvas"`) plus optional granular chrome
     flags, plumbed from the VSCode host through `__MOLVIS_VSCODE_INIT__` into
     page's mount options. Deprecate the dead `init.mode` field.
- **Out of scope (enabled-future — "在这个基础上我们可以做")**:
  - **Structure Outline tree** — a native VSCode tree view (or a
    `surface: "outline"` slim page) that drives selection in the active viewport
    via the RPC router. The flag system is its prerequisite; the tree itself is a
    follow-up spec.
  - **Explorer integration** — clicking a molecular file in VSCode's explorer
    auto-loading it into the activity-bar page.
  - Any `core/` layer change (commands, modifiers, modes, WASM, ImpostorState).
  - Bidirectional text-document ↔ page edit sync.

---

## Architecture Mapping

This is a **host-integration + page-UI** feature. It touches `vsc-ext/` and
`page/` only. It introduces **no** new Commands, Modifiers, Modes, Events, WASM
bindings, or ImpostorState changes — the core-centric tables below are therefore
mostly "None", which is correct and intentional.

### Layer Impact
| Layer | Impact | Files |
|-------|--------|-------|
| System (trajectory/frames) | None | — |
| Artist (GPU thin instances) | None | — |
| SceneIndex (entity registry) | None | — |
| Pipeline (modifier chain) | None | — |
| Mode (interaction) | None | — |
| Core config (UI overlay flags) | Read only (reuse existing `config.ui.*`) | `core/src/config.ts` (unchanged) |
| Page UI (React) | **Extend** | `page/src/lib/mount-opts.ts`, `page/src/lib/mount.tsx`, `page/src/index.tsx`, `page/src/App.tsx`, `page/src/MolvisWrapper.tsx` |
| VSCode extension | **Extend/Modify** | `vsc-ext/package.json`, `vsc-ext/src/extension/panels/pageViewProvider.ts` (new), `vsc-ext/src/extension/activate.ts`, `vsc-ext/src/extension/configuration.ts`, `vsc-ext/src/extension/panels/html.ts`, `vsc-ext/src/extension/types.ts`, `vsc-ext/image/molvis-activitybar.svg` (new) |

### Commands
No new **core** commands needed. (VSCode-level command contributions are covered
under the Design section, not the core `@command` registry.)

### Modifiers
No new modifiers needed.

### Mode Changes
No mode changes needed.

### Events
No new events needed. (The future Outline tree will *consume* existing
`selection-change` / `frame-change` events and emit `selection.*` RPCs — out of
scope here.)

### WASM Integration
No WASM changes needed.

### ImpostorState Impact
No ImpostorState changes needed.

---

## Design

### Surface model

| Surface | VSCode host | Webview bundle | Purpose |
|---------|-------------|----------------|---------|
| **Quick View** | Editor tab — `molvis.quickView` command (title bar) + `molvis.editor` custom editor | `out/webview/index.js` (core canvas, `getPreviewHtml`) | Fast visual peek of an opened molecular file |
| **MolVis** (page) | Activity-bar view (`WebviewViewProvider`) | `out/viewer/index.js` (React page, `getViewerHtml`) | Full workspace app; persistent, not tied to one file |
| **MolVis (wide)** — *retained* | Editor tab — `molvis.openEditor` command | `out/viewer/index.js` | Full page in a wide editor column when the sidebar is too narrow |

`molvis.binaryEditor` (`.dcd/.trr/.xtc`, `priority: "default"`) is unchanged.

### Pillar 1 — Quick View (naming cleanup)
No new webview code. Cleanups in `vsc-ext/package.json`:
- `molvis.editor` custom editor `displayName`: `"MolVis Quick Preview"` → `"MolVis Quick View"` (consistent with the command title `"MolVis: Quick View"`).
- `molvis.quickView` command title stays `"MolVis: Quick View"`.
- Keep `priority: "option"` for `molvis.editor` (molecular files are often edited as text; the title-bar Quick View + explorer entry are the opt-in paths).

### Pillar 2 — Activity-bar page (`WebviewViewProvider`)

`vsc-ext/package.json` contributions:
```jsonc
"contributes": {
  "viewsContainers": {
    "activitybar": [
      { "id": "molvis", "title": "MolVis", "icon": "image/molvis-activitybar.svg" }
    ]
  },
  "views": {
    "molvis": [
      { "type": "webview", "id": "molvis.pageView", "name": "Viewer" }
    ]
  }
}
```
- **Icon**: `image/molvis-activitybar.svg` — a single-path monochrome molecule
  glyph using `currentColor`/no explicit fill so VSCode themes it. (Only a 224 KB
  PNG exists today; the SVG is a new asset.)
- **Provider**: `vsc-ext/src/extension/panels/pageViewProvider.ts` —
  `MolvisPageViewProvider implements vscode.WebviewViewProvider`. In
  `resolveWebviewView`, set `webview.options = { enableScripts: true,
  localResourceRoots: [<extensionUri>/out] }`, then
  `webview.html = getViewerHtml(webview, extensionUri, getMolvisWebviewOptions("full"))`.
  Wire the same message handlers as `viewerPanel.ts` (`ready` → `init`,
  `dropUri`, `error`), and register the view in the existing `panelRegistry` so
  `molvis.reload` / settings-change broadcasts reach it.
  - `WebviewView` has no `WebviewPanel` type; `panelRegistry` currently keys on
    `vscode.WebviewPanel`. Either widen `PanelRegistry` to accept
    `WebviewPanel | WebviewView`, or add a parallel `viewRegistry`. **Decision:
    widen the registry** (smaller surface, one broadcast path). See Risks.
- **Registration**: in `vsc-ext/src/extension/activate.ts`,
  `vscode.window.registerWebviewViewProvider("molvis.pageView", provider,
  { webviewOptions: { retainContextWhenHidden: true } })`.

### Pillar 3 — page surface/flag system

**`page/src/lib/mount-opts.ts`** — extend `MountOpts`:
```ts
export type MolvisSurface = "full" | "canvas"; // extensible: | "outline"

export interface MolvisChromeFlags {
  topBar?: boolean;
  leftSidebar?: boolean;
  rightSidebar?: boolean;
  statusBar?: boolean;
  timeline?: boolean;
}

export interface MountOpts {
  // ...existing wsUrl/token/session/demo...
  /** Named preset expanded into chrome flags. Default "full". */
  surface?: MolvisSurface;
  /** Per-panel overrides applied on top of the surface preset. */
  chrome?: MolvisChromeFlags;
  /** @deprecated alias for `surface: "canvas"`. */
  minimal?: boolean;
}
```
- A pure `resolveChrome(opts): Required<MolvisChromeFlags>` helper maps
  `surface` → default flags (`full` = all true; `canvas` = all false), then
  applies `chrome` overrides, then honors the legacy `minimal` alias. Lives in
  `mount-opts.ts` (pure, unit-testable).

**`page/src/App.tsx`** — replace the binary `minimalMode` with the resolved
flags. `minimalMode` (line 38) becomes `const chrome = resolveChrome(opts)`; each
`{!uiHidden && ...}` chrome block additionally gates on its flag (e.g. `TopBar`
on `chrome.topBar`, `LeftSidebar` on `chrome.leftSidebar`, etc.). The
`canvas` surface reproduces today's `minimal` behavior exactly (all chrome off).

**Host → page plumbing.** The page bundle auto-mounts in `page/src/index.tsx`
via `readMountOptsFromUrl()`. Extend it to merge a host-injected payload:
```ts
mountMolvisApp(rootEl, {
  ...readMountOptsFromUrl(),
  ...readMountOptsFromHost(),   // window.__MOLVIS_VSCODE_INIT__.mount
  useShadowDOM: false,
});
```
- `readMountOptsFromHost()` (new, in `mount-opts.ts`) reads
  `window.__MOLVIS_VSCODE_INIT__?.mount` (a `Partial<MountOpts>`).

**`vsc-ext` side.** Extend the injected payload:
- `vsc-ext/src/extension/configuration.ts`: `getMolvisWebviewOptions(surface?)`
  returns `{ config, settings, mount: { surface } }`.
- `vsc-ext/src/extension/panels/html.ts` `getViewerHtml`: already serializes
  `window.__MOLVIS_VSCODE_INIT__ = <options>`; now the options object carries
  `mount.surface`. No structural change, just a richer payload.
- Activity-bar provider passes `"full"`; the existing `viewerPanel.ts`
  (`molvis.openEditor`) also passes `"full"`.

**Dead-field removal.** `init.mode` (`vsc-ext/src/extension/types.ts:76`,
produced by `createInitMessage` in `configuration.ts`, never read in
`MolvisWrapper.tsx:224` or `controller.ts`) is removed. Surface now travels in the
static `mount` payload (available at mount time, unlike the post-mount `init`
message).

### Data Model
- `MolvisSurface`, `MolvisChromeFlags`, extended `MountOpts` — all in
  `page/src/lib/mount-opts.ts` (page-owned; vsc-ext only *passes values*, never
  imports page types).
- `MolvisWebviewOptions` (`vsc-ext/src/extension/configuration.ts`) gains a
  `mount?: { surface?: string }` field (structural, string-typed — vsc-ext does
  not depend on page's union type).

### UI Components
No new React components in this spec. `App.tsx` chrome blocks become
individually flag-gated. The future Outline tree (out of scope) would be either a
native `TreeDataProvider` in vsc-ext or a new `surface: "outline"` page layout.

---

## Tasks
Order: `page flag model → page consumption → host plumbing → vsc-ext view → naming/cleanup → tests → docs`.

- [ ] **page: surface/flag model** — add `MolvisSurface`, `MolvisChromeFlags`,
   extend `MountOpts`, add pure `resolveChrome()` + `readMountOptsFromHost()` —
   `page/src/lib/mount-opts.ts` — *AC: `resolveChrome({surface:"full"})` all
   true; `{surface:"canvas"}` all false; `{minimal:true}` ≡ canvas; `chrome`
   overrides win.*
- [ ] **page: consume flags in App** — replace `minimalMode` boolean with
   per-panel gating on resolved chrome flags — `page/src/App.tsx` — *AC:
   `surface:"canvas"` renders canvas-only exactly as today's `minimal`;
   `surface:"full"` (default) is unchanged from current behavior.*
- [ ] **page: host opts merge** — call `readMountOptsFromHost()` in the
   auto-mount path — `page/src/index.tsx` — *AC: `window.__MOLVIS_VSCODE_INIT__.mount.surface`
   reaches `App` via `useMountOpts()`.*
- [ ] **vsc-ext: surface in payload** — `getMolvisWebviewOptions(surface)`
   emits `mount.surface`; `getViewerHtml` carries it — `configuration.ts`,
   `panels/html.ts` — *AC: viewer HTML contains `"mount":{"surface":"full"}`.*
- [ ] **vsc-ext: activity-bar view** — new `MolvisPageViewProvider`, widen
   `PanelRegistry` to `WebviewPanel | WebviewView`, register provider with
   `retainContextWhenHidden` — `panels/pageViewProvider.ts` (new),
   `panels/panelRegistry.ts`, `types.ts`, `activate.ts` — *AC: MolVis icon shows
   in the activity bar; clicking it renders the full page; collapsing + reopening
   the view keeps the loaded scene (no reload).*
- [ ] **vsc-ext: activity-bar SVG icon** — add `image/molvis-activitybar.svg`
   (monochrome, `currentColor`), reference in `package.json` — *AC: icon themes
   correctly in light & dark.*
- [ ] **vsc-ext: `package.json` contributions** — `viewsContainers.activitybar`
   + `views` + naming cleanup (`molvis.editor` displayName) — *AC: `npm run
   package` builds; extension activates on view open.*
- [ ] **vsc-ext: remove dead `init.mode`** — drop from `types.ts`,
   `createInitMessage`, all call sites — *AC: `npm run typecheck` (vsc-ext)
   passes with no `mode` references.*
- [ ] **Tests** — see Test Criteria.
- [ ] **Docs** — update `vsc-ext` README / CLAUDE.md surface table to describe
    the three surfaces.

---

## Test Criteria

### Unit Tests (`page/tests/`, `vsc-ext/src/test/unit/`)
- [ ] `resolveChrome({surface:"full"})` → every flag `true`.
- [ ] `resolveChrome({surface:"canvas"})` → every flag `false`.
- [ ] `resolveChrome({minimal:true})` ≡ `resolveChrome({surface:"canvas"})`
      (backward-compat alias).
- [ ] `resolveChrome({surface:"full", chrome:{leftSidebar:false}})` → all true
      except `leftSidebar` (override precedence).
- [ ] `readMountOptsFromHost()` returns `{}` when `__MOLVIS_VSCODE_INIT__` absent
      (no throw off-host).
- [ ] `getMolvisWebviewOptions("full")` returns an object whose serialized form
      contains `mount.surface === "full"`.
- [ ] `panelRegistry` accepts and broadcasts to a mocked `WebviewView` (widened
      type) alongside a mocked `WebviewPanel`.

### Integration Tests (`vsc-ext/src/test/integration/extension-host/`)
- [ ] After activation, `molvis.pageView` is a registered view (extend the
      existing `getRegisteredPanelViewTypes` test harness or add a view check).
- [ ] `molvis.quickView` still opens the core-canvas preview (unchanged).
- [ ] Opening the activity-bar view resolves HTML from `getViewerHtml` (full
      page bundle), not `getPreviewHtml`.

---

## Risks & Open Questions
- **Risk: full WebGL page in a narrow activity-bar view.** The 3D viewport wants
  width; the activity-bar sidebar is typically 200–400 px. → **Mitigation**: the
  sidebar is user-resizable; the `surface: "canvas"`/flag system lets a future
  slim layout drop heavy panels; and `molvis.openEditor` (full page in a wide
  editor tab) is retained as the "give me room" path.
- **Risk: WebviewView lifecycle vs. page auto-dispose.** `page/src/lib/mount.tsx`
  auto-disposes on DOM detach (MutationObserver) and `MolvisWrapper.tsx:200`
  pauses the render loop when offscreen (IntersectionObserver). With
  `retainContextWhenHidden: true` the DOM should persist across collapse, but
  collapse may still trigger the IntersectionObserver → render-loop pause (which
  is *desirable* — no 60 fps when hidden). → **Mitigation**: verify in the
  extension-host test that reopening the view resumes rendering with the scene
  intact; if the MutationObserver fires on collapse, gate auto-dispose on actual
  detachment only. **Validate empirically.**
- **Risk: `PanelRegistry` type widening.** Broadening to
  `WebviewPanel | WebviewView` touches the shared registry used by
  `molvis.reload` and settings broadcast. → **Mitigation**: `WebviewView` also
  has `.webview` and `.visible`/`onDidChangeVisibility`; the registry only uses
  `.webview` + visibility, so widening is mechanical. Covered by a unit test.
- **Open question**: should the activity-bar page and the `molvis.openEditor` tab
  be the *same* logical session (shared scene) or independent instances? This
  spec treats them as **independent webviews** (simplest, matches today's
  panel-per-command model). A shared session is a larger change — defer.
- **Open question**: keep `molvis.openEditor` as a distinct command, or fold it
  into "open the activity-bar view then pop out"? This spec **keeps it** as the
  wide-tab entry. Revisit if it proves redundant after the activity bar ships.

---

## Design Validation

Verdict: **GO.** (A `molvis-architect` pass was attempted but interrupted by an
API session limit; the five boundary questions were self-validated against the
cited files.)

1. **Full WebGL page in an activity-bar `WebviewView` vs. an editor
   `WebviewPanel` — boundary/coupling?** No layer violation and no new coupling.
   `viewerPanel.ts` already hosts the same page bundle in a `WebviewPanel`; a
   `WebviewView` is the same host↔bundle relationship (URL-loaded bundle +
   `postMessage`), just docked in the activity bar. `retainContextWhenHidden` is
   the correct lever. Lifecycle: the `MolvisWrapper.tsx:200` IntersectionObserver
   render-loop pause on collapse is *desirable*; the `mount.tsx` MutationObserver
   auto-dispose fires on **detachment**, not collapse, so `retainContextWhenHidden`
   (DOM persists) should keep the scene alive — **flagged for empirical
   verification** (Risks §2).
2. **Surface contract in page's `MountOpts` — right home?** Yes. page owns
   `MountOpts`; vsc-ext passes **string values** through the existing
   `__MOLVIS_VSCODE_INIT__` channel (same mechanism already used for
   `config`/`settings`). vsc-ext's `MolvisWebviewOptions.mount.surface` is
   string-typed and does **not** import page's `MolvisSurface` union — no
   cross-package type coupling in either direction.
3. **Dual-bundle mirroring?** Not required. All pillar-3 changes are `page/src`
   *source* files (`mount-opts.ts`, `App.tsx`, `index.tsx`, `MolvisWrapper.tsx`)
   compiled by both rsbuild and rslib automatically. No new loader rule, `define`,
   or alias is introduced (`readMountOptsFromHost()` reads a runtime `window`
   global, not a build-time define), so the dual-bundler mirroring rule does not
   trigger. The only manifest change is `vsc-ext/package.json` contributions — not
   a bundler config.
4. **CLAUDE.md invariants?** None touched. No `core`→charting dependency; the
   pipeline single-ingress is untouched (this feature loads no data — page's
   existing `useHostFileBridge` still owns ingress); no
   `UpdateFrameCommand`/`registerFrame` interaction.
5. **Must-fix / simplifications.** (a) The `PanelRegistry` widening to
   `WebviewPanel | WebviewView` is the only non-trivial structural change — the
   registry uses only `.webview` + visibility, both present on `WebviewView`, so
   it is mechanical and unit-tested (Task 5, Risks §3). (b) **Optional
   simplification**: the granular `chrome` flags are only strictly needed by the
   future Outline surface — a minimal cut could ship just the `surface` preset
   (`"full" | "canvas"`) + the `minimal` alias and defer `MolvisChromeFlags`.
   This spec keeps `chrome` because it is cheap and is the exact hook the
   enabled-future work needs, but an implementer may land it in two steps.
