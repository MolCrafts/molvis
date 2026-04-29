# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

Monorepo uses plain **npm workspaces** for orchestration — no turborepo/nx.
Workspace refs use `workspace:*`; rspack-family versions pinned in root
`overrides`. Each sub-package owns `build` / `dev` / `typecheck` / `test`
scripts; root scripts chain them in dependency order.

```bash
# Install all workspace dependencies
npm install

# Development (one dev server at a time)
npm run dev:page       # page dev server at localhost:3000 (bundles core from source)
npm run dev:core       # core's own demo at localhost:3000 (rsbuild dev)
# For Python development: `MOLVIS_PAGE_DIST=page/dist` + a running dev:page.

# Build (core → page → vsc-ext; Python ships the built page bundle)
npm run build:all              # core + page (→ python/src/molvis/dist/) + vsc-ext
npm run build:core             # just core (library dist/ for npm publish)
npm run build:page             # page bundle + copy to python/src/molvis/dist/
npm run build:vsc-ext          # VSCode extension (bundles core from source)

# Test
npm test                       # runs each package's test in declaration order
npm run test:core              # rstest for core (unit + browser)
npm run test:watch             # core watch

# Typecheck (tsc --noEmit per package)
npm run typecheck

# Lint & Format (Biome)
npm run lint
```

**Core consumption**: `page/`, `vsc-ext/`, and `python/` resolve `@molvis/core`
via rsbuild/rslib source alias + tsconfig `paths` → `core/src/index.ts`. They
bundle core from source and do not depend on `core/dist/`. Core's `dist/` is
only produced by `build:core` for npm publishing.

## Monorepo Structure

| Package | Path | Purpose |
|---------|------|---------|
| `@molvis/core` | `core/` | Rendering engine, commands, modes, pipeline |
| `page` | `page/` | React 19 web app — the **single frontend** used by every host |
| `molvis` (extension) | `vsc-ext/` | VSCode extension (custom editor for .pdb/.xyz/.data) |
| `molvis` (pypi) | `python/` | Python package — drives the page bundle over WebSocket; iframe-hosted in Jupyter |

The Python package is no longer an `npm` workspace — it has no JS
build of its own. `npm run build:page` copies `page/dist/*` into
`python/src/molvis/dist/` so the wheel ships the bundle.

Dependencies flow: `page/` and `vsc-ext/` reference `@molvis/core` via source alias (not a workspace dependency). The Python package ships and serves the built `page/dist/` via `WebSocketTransport`. Core depends on `@babylonjs/*` and `@molcrafts/molrs` (local WASM package linked via `link:../../molrs/molrs-wasm/pkg`). The link is a symlink — rebuild wasm with `wasm-pack build --release --target bundler --scope molcrafts` in `molrs/molrs-wasm/` and rslib/rsbuild picks up the new `pkg/` automatically, no reinstall needed. WASM is a single full-subsystem build; no subpath variants.

## Core Architecture

### Layer Separation

- **MolvisApp** (`app.ts`) — Orchestrator. Initializes all subsystems, provides public API (`start()`, `loadFrame()`, `setTrajectory()`, `seekFrame()`, `applyPipeline()`)
- **World** (`world.ts`) — Rendering context. BabylonJS scene, camera (ArcRotateCamera, Z-up), lights, post-processing
- **System** (`system.ts`) — Pure data layer. Owns Trajectory, manages frame navigation, emits `frame-change`/`trajectory-change` events
- **Artist** (`artist.ts`) — Graphics engine. Translates frame data into GPU thin instances. Owns singleton `atom_base_renderer` and `bond_base_renderer` meshes
- **SceneIndex** (`scene_index.ts`) — Entity registry. `ImpostorState` manages GPU buffers in two segments: frame data `[0..frameOffset)` and edit data `[frameOffset..count)`. `MetaRegistry` stores atom/bond metadata

### Command System (`commands/`)

All operations are reversible `Command<T>` objects with `do()`/`undo()`. Use `@command("name")` decorator to register.

**Critical distinction:**
- **DrawFrameCommand** = full scene rebuild (clear + render from scratch)
- **UpdateFrameCommand** = in-place buffer update only (for frame playback, never recreates ImpostorState)

Never mix these two concepts. `UpdateFrameCommand` must never call `sceneIndex.registerFrame()`.

### Mode System (`mode/`)

Five interaction modes with lifecycle: `start()` → active → `finish()`.

| Mode | Key | Purpose |
|------|-----|---------|
| View | 1 | Camera orbit/pan/zoom, grid/PBC toggle |
| Select | 2 | Click-select atoms/bonds, expression selection |
| Edit | 3 | Add/delete atoms with staging workflow |
| Manipulate | 4 | Transform selected groups |
| Measure | 5 | Distance, angle, dihedral measurements |

Edit mode uses a staging pattern: `promoteFrameToEditPool()` → edit → `syncSceneToFrame()` on exit.

### Modifier Pipeline (`pipeline/`)

Stateless chain of `Modifier` objects that transform frames before rendering. Each modifier is a pure function: `apply(frame, context) → new Frame`. Categories: `SelectionSensitive`, `SelectionInsensitive`, `Data`.

The pipeline is the **single ingress for scene data**. Both the sidebar's "Load File" button and the backend's `scene.draw_frame` / `scene.set_trajectory` RPCs funnel through a `DataSourceModifier` at the head of the pipeline — never bypass it when loading data, otherwise downstream modifiers (selection, hide, color) never see the new frame. See `ensureDataSource()` / `ingestFramesIntoPipeline()` in `core/src/transport/rpc/router.ts`.

### RPC Router (`transport/rpc/router.ts`)

`RPCRouter` dispatches inbound JSON-RPC requests from a controller (Python, other languages) into `MolvisApp`. Two command families:

- **`scene.*` / `view.*` / `selection.*` / `snapshot.*`** — imperative, mirror the sidebar's primary actions.
- **`pipeline.*`** — CRUD on the modifier pipeline (`list`, `available_modifiers`, `add_modifier`, `remove_modifier`, `reorder_modifier`, `set_enabled`, `set_parent`, `clear`). Same semantics as clicking sidebar buttons — both paths edit the same `ModifierPipeline` instance.

Both GUI and WS commands are views onto pipeline state; neither is authoritative over the other.

### Event System

Type-safe `EventEmitter` with key events: `frame-change`, `frame-rendered`, `trajectory-change`, `mode-change`, `selection-change`, `dirty-change`, `history-change`.

## WASM Integration (@molcrafts/molrs)

Frame and Box come from WASM. Key APIs:

```typescript
// Frame data access
const block = frame.getBlock("atoms");  // column-based data
block.nrows();
block.copyColStr("element");

// Block columns (typed). All floating columns are Float64Array.
block.setColF("x", new Float64Array([...]));
block.setColU32("i", new Uint32Array([...]));
block.setColI32("type_id", new Int32Array([...]));
block.setColStr("element", ["C", "O", "H"]);
const x = block.viewColF("x");       // Float64Array — wasm-memory view
const xOwned = block.copyColF("x");  // Float64Array — owned copy

// Box — direct property on Frame
const box = frame.simbox;            // Box | undefined

// Box creation (all numeric inputs are Float64Array)
Box.cube(size, origin, pbc_x, pbc_y, pbc_z);
Box.ortho(lengths, origin, pbc_x, pbc_y, pbc_z);
new Box(h_matrix, origin, pbc_x, pbc_y, pbc_z);

// WASM memory: manually free Box / Frame objects you own
box.free();
```

**Cell access for volumetric / box-aware code**: `box.hMatrix()` returns
the 3×3 cell as a flat column-major `Float64Array[9]` — column j of `h`
is the j-th lattice vector. Use this when you need the full cell shape
(triclinic CHGCAR, arbitrary cube voxel vectors); for axis-aligned
cases `box.lengths()` is enough. Same `WasmArray` lifetime rules as
`origin()`/`lengths()` — call `.toCopy()` and free the handle.

**Volumetric data is a Block**, not a separate Grid type. A frame with
voxel data carries a third block named `"grid"` alongside `"atoms"`:
- `frame.getBlock("grid")` returns the `Block`.
- `block.shape()` returns `[nx, ny, nz]` (Uint32Array).
- Each scalar field is a Float64Array column — `density` for cube
  single-density / `mo_<idx>` for cube multi-orbital files,
  `total` (+ optionally `diff` / `mx` / `my` / `mz`) for CHGCAR.
- Build one with `frame.createBlock("grid")` then `block.setColF(name,
  data)` + `block.setShape([nx, ny, nz])`.

**File readers** (all share the `new R(content)`, `read(step)`,
`len()`, `isEmpty()`, `free()` shape):
- Text: `XYZReader`, `PDBReader`, `CIFReader`, `LAMMPSReader`,
  `LAMMPSTrajReader`, `SDFReader`, **`CubeReader`**, **`CHGCARReader`**.
- Binary (Uint8Array): `DCDReader`.

`CubeReader` and `CHGCARReader` are single-frame (`len() == 1`,
`step != 0` returns undefined). `CubeReader` normalises atoms and
simbox to **Å** on read — Bohr files are converted via the 0.529177
factor; the original unit is preserved in `frame.meta["cube_units"]`
for round-tripping.

## Rendering: Thin Instances

Atoms and bonds use BabylonJS thin instances for GPU-efficient rendering. `ImpostorState` manages per-instance buffers (matrix, instanceData, instanceColor, instancePickingColor). The Picker uses ID-pass rendering: mesh ID (12 bits) + instance ID (20 bits) encoded into color for off-screen picking.

## Page (React Web App)

Three-panel layout with `react-resizable-panels`: LeftSidebar (analysis/RDF), center canvas (MolVis), RightSidebar (mode-specific panels). Uses Radix UI primitives + TailwindCSS. State from core events via `useMolvisUiState` and `useSelectionSnapshot` hooks.

### Sidebar UI Design Language

The Edit tab (`page/src/ui/modes/edit/`) sets the visual contract for all
sidebar panels. Reuse it everywhere — same heights, same type scale, same
voice. Anything in a sidebar panel should feel interchangeable with
`BuilderTab` / `DownloadStructureSection` / `ToolsTab`.

**Typography scale** (sidebars run denser than main content):
- `text-[10px]` — section headers (`uppercase tracking-wide font-semibold`), prefix labels ("Source", "Name/CID"), status/hint lines
- `text-[9px]` — subtitles, badges
- `text-xs` (12px) — inputs, buttons with visible text, `SelectItem`s
- `font-mono` on inputs that carry structural text (SMILES, identifiers, paths)

**Control sizing** (don't mix these with generic shadcn defaults):
- `h-7` — primary interactive controls (Input, SelectTrigger, Button)
- `h-6` — `TabsTrigger` inside `TabsList h-7 p-0.5` (nested, denser)
- `h-4` — status bar rows
- Icons: `h-3.5 w-3.5` inside buttons, `h-3 w-3` inline in status lines

**Spacing:**
- Section header: `px-2 py-1`, content wrapper: `px-2 pb-1.5 space-y-1.5`
- Control rows: `flex items-center gap-1.5` with `Input` / `Select` as `flex-1 min-w-0` and a right-aligned icon button (`h-7 px-2`)
- Status lines: `flex items-center gap-1 px-2 py-1` with a leading icon + short imperative text

**Color semantics:**
- `text-muted-foreground` — every non-active label, placeholder, hint
- `text-destructive` + `AlertCircle` — errors
- `text-emerald-500` + `MousePointerClick` — success/next-step prompts
- Active tab / pressed toggle: `variant="secondary"` + optional `ring-1 ring-ring`

**Patterns:**
- Wrap each logical group in `<SidebarSection>` (collapsible). Secondary/less-used sections start with `defaultOpen={false}` (e.g. `DownloadStructureSection`).
- For a section that should fill remaining vertical space, pass `className="flex-1 min-h-0 flex flex-col"` **and** `contentClassName="flex-1 min-h-0 flex flex-col"` — both are required because `SidebarSection` renders a `<section>` → content `<div>` wrapper.
- Icon-only tabs/buttons: `aria-label` + `title`, never visible text underneath. Use `grid grid-cols-N gap-0.5` for tab bars and toggle groups.
- Prefix labels sit left of their control, `w-10 shrink-0 text-[10px] text-muted-foreground`, so inputs align across rows.
- Disabled dropdown items keep the choice visible with a `(soon)` suffix instead of being hidden.

**Writing style:**
- Section titles: 1–3 words, rendered uppercase via CSS. Prefer nouns ("SMILES", "2D Sketch", "Download Structure"). Never add "Settings" / "Options" / "Panel" suffixes.
- Placeholders/examples: show a real value, not an instruction (`"CCO"`, `"aspirin or 2244"`, `"1tqn"` — not "Enter a SMILES…").
- Status copy: short imperative, ≤6 words ("Click the 3D canvas to place", "Draw a molecule first"). No trailing period in inline hints.
- Error messages: ≤10 words and specific ("PubChem: \"foo\" not found", "Switch to Edit mode first").
- Icon-only controls carry matching `title` and `aria-label`; do not duplicate that text in the DOM.

When adding a new panel or moving an old one, compare it against the Edit
tab first and match these conventions before reaching for stock shadcn
sizes — the generic defaults (`h-9`, `text-sm`) are too loose for the
sidebar.

## VSCode Extension

Hosts MolVis via webview with message-based communication (`HostToWebviewMessage`/`WebviewToHostMessage`). Two integration paths: CustomTextEditor for .pdb/.xyz/.data files, and standalone viewer panel. CSP requires `'wasm-unsafe-eval'` for molrs.

## Testing Patterns

Tests use rstest framework. Mock `SceneIndex` for unit tests (no BabylonJS needed). Test modifiers in isolation via `apply(frame, context)`. Selection tests check `SelectionManager.getState()`.

## Frame Transition Strategy

`FrameDiff` (`system/frame_diff.ts`) classifies frame transitions as "position" (fast buffer update) or "full" (rebuild). This determines whether `UpdateFrameCommand` or `DrawFrameCommand` is used during trajectory playback.

## Development Skills & Agents

This project includes specialized skills (`.claude/skills/`) and agents (`.claude/agents/`) for multi-agent development.

### Skills (slash commands)

| Skill | Purpose |
|-------|---------|
| `/molvis-spec <description>` | Map user request to MolVis patterns (Command/Modifier/Mode/WASM); produce architecture-adapted spec |
| `/molvis-impl <spec path>` | Orchestrate multi-agent implementation of an approved spec |
| `/molvis-arch <scope>` | Structural review: layer separation, pattern classification, package boundaries |
| `/molvis-test <feature>` | Design and write tests for MolVis features (TDD workflow) |
| `/molvis-perf <scope>` | Diagnose performance issues: hot paths, WASM boundary, GPU buffers |
| `/molvis-doc <scope>` | Generate JSDoc/TSDoc for commands, modifiers, and public APIs |
| `/molvis-review <scope>` | Aggregate review: arch + perf + doc + rendering safety in parallel |
| `/molvis-iterate` | Product iteration cycle: lead agent proposes next improvement, waits for approval |

### Agents (subagents)

| Agent | Responsibility (single) |
|-------|------------------------|
| `molvis-explorer` | Find files, trace data flow, answer "how does X work?" |
| `molvis-architect` | Validate design decisions against layer rules and patterns (not exploration, not task breakdown) |
| `molvis-planner` | Break an approved design into phased, dependency-ordered tasks |
| `molvis-reviewer` | Behavioral correctness: WASM safety, immutability, command symmetry, buffer invariants |
| `molvis-tester` | Write tests in rstest; enforce TDD (RED → GREEN → REFACTOR) |
| `molvis-documenter` | Write TSDoc/JSDoc for public symbols, commands, and modifiers |
| `molvis-optimizer` | Implement performance fixes for identified hot paths |
| `molvis-lead` | Product strategy: propose one iteration at a time, never implement without approval |

**arch vs reviewer**: `molvis-arch` = "is this in the right layer using the right pattern?" / `molvis-reviewer` = "is the implementation of that pattern correct?"
**perf vs optimizer**: `molvis-perf` = diagnose (identify issues) / `molvis-optimizer` = fix (implement optimizations)
**architect vs explorer vs planner**: `architect` = design decisions / `explorer` = find existing code / `planner` = task breakdown

### Typical Workflow
```
/molvis-spec "add angle measurement between 3 atoms"
→ review and approve the spec
/molvis-impl docs/specs/angle-measurement.md
→ parallel agents (planner → tester + core + ui) → verify → review
```
