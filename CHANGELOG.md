# Changelog

All notable changes to MolVis are documented here. The whole repo is
version-locked to one tag, so this is the single changelog for the core
engine, the web page, the VSCode extension, and the Python package.

This file is the source of truth for the in-app "What's new" dialog — the
page reads it at build time (see `page/src/lib/changelog.ts`). Keep the
format below: `## [version] - date`, then `### Section` groups, then
`- bullet` items.

## [0.0.11] - 2026-07-17

### Embedding
- **`<molvis-viewer>` custom element** — a browser-native element for dropping an
  interactive structure into any HTML page or docs site. Load the new
  side-effect bundle from a CDN and the element registers itself:
  `<script type="module" src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-core@latest/dist/elements.js">`.
  Takes either a `src` URL or an inline `<template data-molvis-source>` child.
  The structure still enters through the normal loader and modifier pipeline —
  the element only adds declarative mounting and lifecycle.
- New core subpath exports `./element` and `./elements` (the latter is the
  self-registering CDN bundle; importing `@molcrafts/molvis-core` itself never
  auto-registers).
- **Markdown fence** (`molvis.mdx`) — Zensical/Python-Markdown authors can put
  file content straight in a ```molvis fence with a required `format` option, so
  the build never guesses how to parse it. See `docs/getting-started/embedding.md`.

### Analysis
- The analysis catalog is now driven by molrs's compute catalog
  (`molrsComputeCatalog()`) instead of a hand-written registry that drifted from
  the bindings: every entry names a real binding and its ctor params really
  construct, both pinned by tests.
- Requirement probing — an analysis is blocked with a reason naming the exact
  missing frame columns (`vx`/`vy`/`vz`, `charge`, the `quat*` set) or the
  missing `bonds` block, rather than failing at run time.
- Trajectory-wide analysis runner plus generic, RDF, and MSD result panels.

### Core
- Data-source **composition** replaces the scene-synthesis node: composition is
  now a scene-level concern (`source_composition`), and the `SceneSynthesis`
  modifier, its panel, and its state hook are gone.

### VSCode
- The activity-bar entry is now a lightweight **native launcher** — an "Open
  MolVis Workspace" button plus a pointer to the Explorer context menu — instead
  of hosting the full React page inside the narrow sidebar. The full page opens
  as an editor tab (`molvis.openEditor`), and file browsing is delegated to the
  native Explorer (`molvis.quickView` / `molvis.openEditor` context menu +
  custom editors). This removes a heavyweight WebGL/WASM webview from the sidebar.

### Page
- Responsive narrow layout: below a container-width breakpoint the three-panel
  layout collapses to a full-width canvas with the sidebars available as overlay
  drawers. The canvas stays mounted across the breakpoint, so the WebGL/WASM
  engine is never torn down.
- Compact top bar and timeline at narrow widths; sidebar tables and RDF inputs
  reflow instead of overflowing.
- Click the **MolVis** wordmark (top-left) to open the version + changelog dialog.

### Camera
- Scroll-wheel zoom is now radius-proportional (`wheelDeltaPercentage`) instead
  of a constant step, so one notch changes the view by the same fraction at
  every scale — fixing the crawling zoom on large systems and the zoom speed
  that varied with distance from the anchor.

### Branding
- New MolVis mole logo (mole + magnifier + benzene) across every asset — the
  marketplace icon, the activity-bar glyph, the README logo, and the page
  favicon (previously missing).

### Chore
- Bump `@molcrafts/molrs` and `molcrafts-molpy` to 0.8.0.

## [0.0.10] - 2026-07-05

### VSCode
- Three distinct viewer surfaces, cleanly separated:
  - **Quick View** — the lightweight core canvas (editor title-bar
    `molvis.quickView` + the `molvis.editor` custom editor) for a fast peek at an
    opened molecular file.
  - **MolVis** — the full React page, now hosted in a new **activity-bar view**
    (`WebviewViewProvider`, registered with `retainContextWhenHidden` so the
    WebGL scene survives the view being collapsed). New monochrome activity-bar
    icon.
  - **MolVis (wide)** — the full page in a wide editor tab (`molvis.openEditor`).
- `PanelRegistry` widened to broadcast reload/settings to both webview panels and
  the activity-bar webview view.

### Page
- Host-aware chrome flags: a `MountOpts.surface` preset (`"full"` | `"canvas"`)
  plus per-panel `chrome` overrides, plumbed from the VSCode host through
  `window.__MOLVIS_VSCODE_INIT__.mount`. The legacy `minimal` flag becomes a
  backward-compat alias for `surface: "canvas"`.

## [0.0.9] - 2026-07-04

### Core
- Bump `@molcrafts/molrs` to 0.6.0 — a wasm-bindgen bundler-target build (WASM
  auto-initializes on import) carrying the GRO/MOL2/POSCAR/TRR/XTC readers and
  binary writers the expanded IO relies on
- glTF/GLB export: `exportFrameToGLB` / `MolvisApp.exportGLTF` serialize the
  scene to a self-contained binary glTF of real ball-and-stick geometry —
  matte, element-coloured, split-coloured bonds, bond orders — viewable in any
  glTF viewer with zero MolVis runtime
- Data-source composition: scene-level source composition (trajectory-unify, acquisition
  re-axis) replacing the CombineSystems node
- ComputeBonds modifier: dynamic distance / covalent bond perception, with
  unwrapped `xu`/`yu`/`zu` coordinate support
- Advanced reset camera: radius-aware, per-axis, OBB- and PBC-aware, with
  automatic view-direction selection
- Semi-headless `MolvisRenderer` facade (runs under a `NullEngine`)

### IO
- New writers: MOL2, CIF, Cube, GRO, POSCAR, DCD, TRR, XTC, plus export wiring
- New loaders: GROMACS, VASP, MOL2
- Per-element colours for XYZ files
- "Auto" load mode keeps topology when dropping a trajectory onto an open structure

### UI
- Soft Tableau default type colours with golden-angle overflow (vivid palette)
- Wireframe overlays for all molpack confinement regions
- Trajectory and view panel refinements

### VSCode
- Binary editor provider for molecular files
- Stream large trajectories instead of loading them whole

### Chore
- Charting extracted into the standalone `@molcrafts/molplot` package (Vega-Lite),
  now consumed as the published `@molcrafts/molplot@0.1.0` dependency
- Stop committing `package-lock.json`; CI resolves dependencies fresh

## [0.0.7] - 2026-05-30

### Core
- Bump @molcrafts/molrs to 0.0.14
- Model volumetric grids as blocks (Cube / CHGCAR readers)
- IO / overlay / runtime cleanup after core review

### UI
- Version badge in the top bar opens this changelog
- Translucent overlays no longer hide atoms underneath

## [0.0.6] - 2026-05-20

### Core
- Add repository / homepage / bugs metadata to package.json
- Core review remediation pass
