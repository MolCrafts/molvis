# Spec: Cube / CHGCAR Voxel File Loading + Isosurface Rendering

## Summary
Add end-to-end support for Gaussian Cube (`.cube`) and VASP CHGCAR
(extension-less, filename = `CHGCAR*`) volumetric files: parse them into a
`Frame` carrying both an atoms block and a `"grid"` block, then render the
scalar field as an interactive isosurface via Marching Cubes.

## Motivation
Today MolVis can render structures from seven formats (PDB / XYZ / CIF /
LAMMPS / LAMMPS-dump / SDF / DCD), but every workflow that involves
**volumetric data** — DFT charge density, electrostatic potential, MOs,
spin density — has no entry point. The pieces are already there:
- `marchingCubes()` works (`core/src/algo/marching_cubes.ts`, fully tested).
- `molrs-io` already has Rust parsers `cube.rs` (587 lines) and
  `chgcar.rs` with real fixtures under
  `molrs-core/target/tests-data/{cube,chgcar}/`:
  - `chgcar/`: 5 good (Li_nospin / Li_spin / NiO_soc / Fe3O4_spin /
    Fe3O4_ref) + a `bad/` directory of malformed-input cases.
  - `cube/`: 5 fixtures spanning the format's quirks —
    - `valtest.cube` — 5×1×1×1 hand-crafted threshold test;
    - `grid20.cube` — ORCA spin density, 16 atoms, 20³, **Bohr units**;
    - `grid20ang.cube` — same molecule, 20³, **Ångström units**
      (encoded as a negative first-dim count, per cube spec);
    - `grid20mo6-8.cube` — ORCA molecular orbitals 6–8, 20³, with
      **negative natoms = −7** (multi-orbital file: 3 scalar fields
      stored side-by-side in one cube);
    - `grid25mo.cube` — 25³, single MO via the negative-natoms path.

The gap is purely glue: the Rust parsers use a deprecated
`Frame::insert_grid` path, the WASM layer doesn't expose them, and
neither the registry nor a Draw modifier knows what to do with a grid
block. This spec closes that gap and lifts the cube reader to handle
the unit and multi-orbital quirks the new fixtures require.

## Scope
- **In scope**:
  - Rust: re-target `cube.rs` / `chgcar.rs` so the produced `Frame`
    carries the volumetric data as a `"grid"` block (`Block` with
    `setShape([nx,ny,nz])` + scalar columns) plus an atoms block plus a
    `simbox`. Drop dependence on the legacy `Frame::insert_grid` API.
  - molrs-wasm: expose `CubeReader` and `CHGCARReader` classes
    matching the existing reader contract (`new R(content)`, `len()`,
    `read(step)`, `free()`).
  - molvis-core: register `cube` + `chgcar` formats; wire WASM readers
    in `openTextReader`; add a `DrawIsosurfaceModifier` (auto-attaches
    when `frame.getBlock("grid")` exists) that calls a new
    `artist.drawIsosurface()` implementation built on the existing
    `marchingCubes()` algorithm.
  - molvis-page: a small isosurface settings panel (isovalue slider,
    color, opacity, sign-toggle for spin difference) hooked into the
    auto-attached modifier — same UI conventions as the Edit tab.
  - Tests: rstest browser tests that load **every fixture** from
    `molrs-core/target/tests-data/cube/` and
    `molrs-core/target/tests-data/chgcar/` (good cases) and verify
    atoms + grid block + simbox; an end-to-end pipeline test (load →
    auto-attach → marching cubes → mesh registration); the `bad/`
    CHGCAR cases keep producing `MolRsError` rather than silent corruption.
  - Cube quirks the reader must handle correctly:
    - **Unit normalisation**: a negative first-dim count means the cell
      vectors are in Å, positive means Bohr. The `Frame.simbox` MUST
      always be in Å (molvis's world unit). Bohr → Å uses the
      conversion factor 0.52917721067.
    - **Multi-orbital files** (negative natoms): N scalar fields stored
      contiguously per voxel. Each becomes a separate column on the
      grid block: `mo_<index>` (e.g. `mo_6`, `mo_7`, `mo_8` for
      `grid20mo6-8.cube`). The `DrawIsosurfaceModifier`'s channel
      selector exposes them all.
- **Out of scope**:
  - **Multi-block grids** (CHGCAR spin "diff" channel and SOC's three
    extra blocks) beyond storing them. The first iteration renders the
    *first* scalar field; a sign-toggle in the UI flips between
    `total` / `diff` for spin files. Per-channel modifier instances
    are a follow-up.
  - **Streaming reader path** for these formats — both are eager-only
    (`streaming: "eager-only"`) like CIF/DCD already are. A 13 MB
    CHGCAR (Fe3O4_spin) materializes once.
  - **Volume rendering** (3D texture + ray-marched DVR). Marching
    cubes only.
  - **Writers**. `cube.rs` already has `write_cube`; not exposed.

---

## Architecture Mapping

### Layer Impact
| Layer | Impact | Files |
|-------|--------|-------|
| WASM bindings (molrs-wasm) | New | `molrs/molrs-wasm/src/io/reader.rs`, `molrs/molrs-io/src/cube.rs`, `molrs/molrs-io/src/chgcar.rs` |
| System (trajectory/frames) | None | — |
| Artist (GPU thin instances) | Extend | `core/src/artist.ts` (new `drawIsosurface`), new `core/src/artist/isosurface/` |
| SceneIndex (entity registry) | None | — (isosurface mesh is a regular non-instanced Babylon mesh, registered like `sim_box`) |
| Pipeline (modifier chain) | Extend | new `core/src/pipeline/draw_isosurface.ts`, `core/src/pipeline/modifier_registry.ts`, `core/src/io/formats.ts`, `core/src/io/reader.ts` |
| Mode (interaction) | None | — |
| Page UI (React) | Extend | new `page/src/ui/modes/view/modifiers/DrawIsosurfaceModifier.tsx` |
| VSCode extension | None | — (inherits from page bundle automatically) |

### Commands
**No new commands needed.** Loading flows through the existing
`DataSourceModifier` ingress (the same path PDB/XYZ use); rendering
state changes (isovalue, color) live as modifier params inside the
already-reversible pipeline-edit commands.

### Modifiers
| Field | Value |
|-------|-------|
| Name | `DrawIsosurfaceModifier` |
| File | `core/src/pipeline/draw_isosurface.ts` |
| Category | Capability `Draws` (parallels `DrawAtomModifier` / `DrawBoxModifier`) |
| Input | `frame.getBlock("grid")` (column `density` for cube; `total` and `diff` for CHGCAR), `frame.simbox` (for `cell` + `origin`) |
| Output | Frame returned unchanged (this is a side-effect Draw modifier — same as `DrawAtomModifier`); BabylonJS isosurface mesh installed via `artist.drawIsosurface(...)` |
| `matches(frame)` | `frame.getBlock("grid") !== undefined && grid.shape().length === 3 && frame.simbox !== undefined` |
| Pattern reference | Analogous to `DrawBoxModifier` in `core/src/pipeline/draw_box.ts` (auto-attaches on `frame.simbox`, calls `artist.drawBox(...)`) |

### Mode Changes
**No mode changes.** Isosurface is purely a render layer. View mode's
camera/picking already cooperate because the new mesh is registered
with `isPickable = false` (same as `sim_box`).

### Events
**No new events.** Re-renders are triggered by the existing
`frame-change` plus modifier-param changes through the standard pipeline
re-evaluation path.

### WASM Integration
- **New molrs bindings needed**: Yes — `CubeReader` and `CHGCARReader`
  in `molrs/molrs-wasm/src/io/reader.rs`. Same shape as the existing
  seven readers (constructor takes `&str`, methods `read(step)`,
  `len()`, `is_empty()`, `free()`). Single-frame from molrs's POV: the
  Frame they emit just happens to also carry a grid block.
- **Box objects created**: Yes. CHGCAR carries a triclinic lattice
  (`new Box(h_matrix, origin, pbc=true,true,true)`); cube carries an
  orthorhombic-aligned voxel cell. Freed by the `DataSourceModifier`'s
  existing trajectory disposal path — no new ownership rules.
- **WASM memory ownership**:
  - `CubeReader` / `CHGCARReader` own their inner `BufRead`-cursor and
    a one-shot frame; lifetime ends with `free()`. Identical to
    `XYZReader`.
  - The grid `Float64Array` is always copied out via `block.copyColF`
    in the modifier (never a `viewColF` view) so the marching-cubes
    pass cannot read torn data after a frame change.

### ImpostorState Impact
**No ImpostorState changes.** Isosurface is **not** a thin-instance
entity. It is a plain `Mesh` with `setVerticesData` / `setIndices`
(same kind of mesh as `sim_box`), registered via `sceneIndex` only so
the picker's mesh-ID color encoding can skip it. Atom and bond
ImpostorState slots are untouched.

---

## Design

### Data Model

#### Rust side — Frame layout produced by both readers
```
Frame
├── meta: {"title": ..., "format": "cube"|"chgcar", ...}
├── simbox: Box                          // unit cell (cube: voxel
│                                          spacing × shape; chgcar:
│                                          POSCAR lattice)
├── block "atoms"
│   ├── columns x, y, z: f64
│   ├── element: string (Z → element symbol via molrs PT)
│   └── (optional) charge: f64
└── block "grid"                          // ★ new: replaces insert_grid
    ├── shape: [nx, ny, nz]               // via setShape()
    └── columns (one f64 column per scalar field)
        ├── density: f64                  // cube single-MO / total density
        ├── mo_<idx>: f64                 // cube multi-orbital path
        │                                 // (one column per orbital,
        │                                 //  e.g. mo_6, mo_7, mo_8)
        └── total / diff / mx / my / mz   // CHGCAR spin and SOC blocks
```

Layout rule: voxels are stored **row-major with `ix` outermost**:
`data[ix*ny*nz + iy*nz + iz]`. This matches what `marchingCubes()`
already expects (see `core/src/algo/marching_cubes.ts` line 391). The
existing CHGCAR reader's `vasp_to_row_major()` already does the
transpose — we keep it.

#### TypeScript types
New interface in `core/src/pipeline/draw_isosurface.ts`:

```typescript
export interface IsosurfaceStyle {
  isovalue: number;          // default chosen at attach time (see below)
  color: [number, number, number]; // 0..1 RGB; default sky blue
  opacity: number;           // 0..1; default 0.6
  channel: "density" | "total" | "diff" | "mx" | "my" | "mz";
  showNegative: boolean;     // for spin "diff": draw +iso AND -iso
                             //  with a contrasting color
}
```

#### Default isovalue heuristic
Picked once when the modifier auto-attaches, sampled from the
currently-selected channel:
- Cube `density`: `0.05 * max(|density|)` — common default for
  charge-density visualization (matches VMD).
- Cube `mo_*`: `0.04 * max(|ψ|)` with `showNegative = true` — orbital
  lobes are signed and need the ±iso pair.
- CHGCAR `total`: `0.5 * mean(|density|)` — empirical default that
  brackets crystalline charge density without saturating.
- CHGCAR `diff`: `0.02 * max(|diff|)` with `showNegative = true`.

Stored on the modifier (not the frame); user-tunable via the UI.

### UI Components

New file `page/src/ui/modes/view/modifiers/DrawIsosurfaceModifier.tsx`,
following the **Edit-tab visual contract** (CLAUDE.md):

```
[Section header "ISOSURFACE"]                  text-[10px] uppercase
  Channel:    [Select: density | total | diff …]   h-7
  Isovalue:   [Slider]  [number input]             h-7
  Color:      [color picker]                       h-7
  Opacity:    [Slider]                             h-7
  ▢ Show negative isosurface                       checkbox
```

Live-binds to the modifier via the same `useModifierParams` hook used by
`DrawAtomModifier.tsx` / `DrawBondModifier.tsx`.

### Renderer (artist side)

New file `core/src/artist/isosurface/isosurface_renderer.ts`:

```typescript
class IsosurfaceRenderer {
  private mesh: Mesh | null = null;
  private mesh_neg: Mesh | null = null;   // when showNegative is on

  rebuild(frame: Frame, style: IsosurfaceStyle): void {
    // 1. Pull grid block + its scalar column.
    const grid = frame.getBlock("grid")!;
    const data = grid.copyColF(style.channel);  // owned copy
    const [nx, ny, nz] = grid.shape() as Uint32Array;

    // 2. Pull cell from simbox (column-major 3×3 + origin).
    const box = frame.simbox!;
    const cell   = copyAndFree(box.h_matrix());
    const origin = copyAndFree(box.origin());

    // 3. Marching cubes.
    const mesh = marchingCubes(data, [nx,ny,nz], cell, origin, style.isovalue);
    this.installMesh(mesh, /*sign=*/+1, style);

    if (style.showNegative) {
      const mesh2 = marchingCubes(data, [nx,ny,nz], cell, origin, -style.isovalue);
      this.installMesh(mesh2, /*sign=*/-1, style);
    }
  }
  setVisible(b: boolean): void { … }
  dispose(): void { … }
}
```

`MolvisApp.artist.drawIsosurface(frame, style)` becomes a one-liner
delegate to `isosurfaceRenderer.rebuild(...)` — the same shape as
`drawRibbon` / `drawBox`.

### Format registry change
Two new entries in `core/src/io/formats.ts`:

```typescript
{
  format: "cube",
  label: "Gaussian Cube",
  description: "Gaussian-style volumetric scalar field with embedded geometry (.cube, .cub)",
  extensions: ["cube", "cub"],
  payload: "text",
  streaming: "eager-only",
},
{
  format: "chgcar",
  label: "VASP CHGCAR",
  description: "VASP charge density / spin density (filename CHGCAR or CHGCAR_*)",
  extensions: ["chgcar", "CHGCAR"],   // see filename-match note below
  payload: "text",
  streaming: "eager-only",
},
```

**Filename-match concession.** `inferFormatFromFilename` currently
keys off the lowercased extension. CHGCAR is extension-less. Two
small changes in `formats.ts`:
1. Before `extensionOf`, check if `basename(filename)` exactly matches
   `CHGCAR` (case-sensitive, optionally followed by `_<tag>`) and
   short-circuit to `"chgcar"`.
2. `getAllAcceptExtensions()` keeps appending `.chgcar` for users who
   rename the file; the basename-rule covers the canonical name.

### Reader dispatch
`openTextReader` in `core/src/io/reader.ts` gains:
```typescript
case "cube":   return new CubeReader(content);
case "chgcar": return new CHGCARReader(content);
```

### Auto-attach
The new `DrawIsosurfaceModifier` is registered in
`modifier_registry.ts` under category `"Draw"`, then picked up
automatically by `applyAutoAttach` in `core/src/pipeline/auto_attach.ts`
because its `matches()` returns `true` whenever the loaded frame has a
3-D grid block.

---

## Tasks
Ordered by dependency:

1. [ ] **Rust: re-target `cube.rs` to write a grid Block** — emit
   `frame.create_block("grid")`, `setShape([nx,ny,nz])`, one
   `setColF("density"|"mo_<idx>", ...)` call per scalar field
   (handling negative-natoms multi-orbital path), instead of
   `frame.insert_grid("cube", grid)`. Box from `Box::triclinic(...)`
   in **Å** (Bohr→Å conversion when first-dim count is positive).
   `molrs/molrs-io/src/cube.rs`. **Acceptance**: a new rstest
   `tests/test_io/test_cube.rs` loads every fixture under
   `tests-data/cube/` and asserts:
   - `valtest.cube` → shape `[5,1,1,1?]` collapsed to `[5,1,1]`,
     density sequence `[-1e2, -1e-2, 0, 1e-2, 1e2]`, atoms count 2.
   - `grid20.cube` → shape `[20,20,20]`, atoms count 16, simbox
     extents in Å (≈ 12.2 × 12.86 × 12.7).
   - `grid20ang.cube` → same atoms / shape, simbox in Å (no Bohr→Å
     scaling applied).
   - `grid20mo6-8.cube` → 3 grid columns named `mo_6`, `mo_7`, `mo_8`,
     atoms count 7.
   - `grid25mo.cube` → 1 grid column `mo_5`, shape `[25,25,25]`, atoms
     count 7.

2. [ ] **Rust: re-target `chgcar.rs` to write a grid Block** — keep
   `vasp_to_row_major` ordering; produce columns `total` and (if
   present) `diff` / `mx` / `my` / `mz`. Box from `Box::triclinic`.
   `molrs/molrs-io/src/chgcar.rs`. **Acceptance**: existing
   `tests/test_io/test_chgcar.rs` switches its assertions from
   `frame.get_grid("chgcar")` to `frame.get_block("grid")` and still
   passes for all 5 good fixtures + bad-file expectations remain
   correct.

3. [ ] **WASM: expose `CubeReader` and `CHGCARReader`** in
   `molrs/molrs-wasm/src/io/reader.rs`, mirroring `XyzReader`'s shape:
   constructor takes `&str`, `read(step)` returns `Option<Frame>`
   (always `Some(frame)` when `step==0`, `None` otherwise — both
   formats are inherently single-frame), `len() == 1`. Re-export from
   `molrs/molrs-wasm/src/io/mod.rs`. **Acceptance**: `wasm-pack build
   --release --target bundler --scope molcrafts` produces a `pkg/`
   exporting `CubeReader` and `CHGCARReader`; existing molvis tests
   still typecheck.

4. [ ] **TS: register `cube` + `chgcar` in `FILE_FORMAT_REGISTRY`** —
   `core/src/io/formats.ts`. Add the basename short-circuit for the
   extension-less `CHGCAR` filename. **Acceptance**:
   `inferFormatFromFilename("CHGCAR")` returns `"chgcar"`;
   `inferFormatFromFilename("foo.cube")` returns `"cube"`;
   `getAllAcceptExtensions()` includes `.cube,.cub,.chgcar`.

5. [ ] **TS: wire WASM readers in `openTextReader`** —
   `core/src/io/reader.ts` switch gets `cube` and `chgcar` cases.
   **Acceptance**: `loadTextTrajectory(content, "CHGCAR")` returns a
   `Trajectory` of length 1 whose only frame has a grid block.

6. [ ] **Core: implement `IsosurfaceRenderer`** —
   `core/src/artist/isosurface/isosurface_renderer.ts`. Hook
   `MolvisApp.artist.drawIsosurface(frame, style)` in
   `core/src/artist.ts`. Mesh registered as non-pickable, visible by
   default. **Acceptance**: an rstest test (mocked SceneIndex) drives
   `drawIsosurface` against a hand-built grid frame and asserts the
   produced mesh has > 0 vertices.

7. [ ] **Pipeline: `DrawIsosurfaceModifier`** —
   `core/src/pipeline/draw_isosurface.ts`. Capabilities:
   `{Draws}`. `matches(frame)` checks for 3-D grid block. Register in
   `modifier_registry.ts`. **Acceptance**: rstest:
   `applyAutoAttach(pipeline, frame_with_grid)` returns a list
   containing `"Draw Isosurface"`.

8. [ ] **UI: `DrawIsosurfaceModifier.tsx`** —
   `page/src/ui/modes/view/modifiers/DrawIsosurfaceModifier.tsx`.
   Match the Edit-tab visual contract (`h-7`, `text-[10px]` headers,
   `text-xs` controls). **Acceptance**: opening a CHGCAR in the page
   dev server shows the panel under "View → Draw" and the slider
   live-updates the surface.

9. [ ] **Integration tests** — `core/tests/cube_chgcar_load.test.ts`:
   for **every** fixture in
   `molrs-core/target/tests-data/{cube,chgcar}/` (skip the `bad/`
   directory), load via `loadTextTrajectory`, run the pipeline, and
   assert auto-attached modifiers include `"Draw Isosurface"`. Use
   rstest's file-system fixture loader (test runs in browser env via
   the existing `setup_wasm.ts`). Per fixture:
   - cube — assert `frame.getBlock("grid")` exists, the modifier's
     channel selector lists every column produced by the reader (1
     for single-MO files, 3 for `grid20mo6-8.cube`).
   - chgcar — assert `frame.getBlock("atoms").nrows()` matches the
     expected atom count and the channel list contains `"total"`
     (and `"diff"` for `Li_spin`, `Fe3O4_spin`).
   - For at least one fixture per format, run the modifier and assert
     `MCMesh.positions.length > 0` at the default isovalue.
   **Acceptance**: 10 fixtures (5 cube + 5 chgcar) pass; bad-CHGCAR
   files still error in `test_chgcar.rs` (Rust side) — no silent
   corruption reaches the frontend.

10. [ ] **Docs** — Update top-level `CLAUDE.md` "WASM Integration"
    section: note the new `CubeReader` / `CHGCARReader` and the grid-as-
    block convention. Update `core/CLAUDE.md` if format list is
    enumerated. **Acceptance**: `grep -n "CHGCAR" CLAUDE.md` returns ≥
    one hit referring to the new reader.

---

## Test Criteria

### Unit Tests (`core/tests/`)
- [ ] **Format inference**:
  - `inferFormatFromFilename("water.cube") === "cube"`
  - `inferFormatFromFilename("CHGCAR") === "chgcar"` (basename rule)
  - `inferFormatFromFilename("CHGCAR_sum") === "chgcar"`
  - Unknown extension still returns `null`.
- [ ] **CubeReader against tests-data** (one test per fixture):
  - `valtest.cube` — 5 voxels, exact density sequence
    `[-1e2, -1e-2, 0, 1e-2, 1e2]` round-trips.
  - `grid20.cube` (Bohr) and `grid20ang.cube` (Å) yield **the same**
    simbox extents in Å (parity check on the unit-conversion path).
  - `grid20mo6-8.cube` produces 3 grid columns (`mo_6`, `mo_7`, `mo_8`),
    each of length `20*20*20`.
  - `grid25mo.cube` produces 1 grid column, shape `[25,25,25]`.
- [ ] **CHGCARReader against tests-data** (one test per fixture, all
  in one describe block):
  - `Li_nospin`: 1 atom, `[32,32,32]`, no `diff` column.
  - `Li_spin`: 1 atom, `[48,48,48]`, both `total` and `diff`.
  - `NiO_soc`: 4 atoms, `[56,56,56]`, columns include
    `total` + `mx`/`my`/`mz`.
  - `Fe3O4_spin`, `Fe3O4_ref`: load without throwing.
- [ ] **`DrawIsosurfaceModifier.matches`** is `false` for an
  atoms-only frame (PDB) and `true` for a CHGCAR frame.
- [ ] **`marchingCubes` integration**: after loading Li_nospin, the
  modifier produces a non-empty MCMesh at the default isovalue.
- [ ] **Pipeline purity**: applying `DrawIsosurfaceModifier` to a
  frame returns the same Frame instance (it's a Draw modifier; no
  data mutation).

### Integration Tests
- [ ] **End-to-end load**: open `CHGCAR.Li_nospin` via the same code
  path as a button-click upload (`loadFileContent`) and verify the
  pipeline ends up with `[DataSource, DrawAtoms, DrawBox,
  DrawIsosurface]`.
- [ ] **Isovalue update**: after load, change
  `DrawIsosurfaceModifier.style.isovalue` and assert the renderer
  rebuilds (mesh vertex count changes).
- [ ] **Channel switch (Li_spin)**: switch channel from `total` to
  `diff`; assert mesh is re-extracted from the second column.
- [ ] **Box memory hygiene**: after disposing the trajectory,
  `frame.simbox` and the grid block are freed (no WASM leak — checked
  via `WasmArray.activeCount()` if available, otherwise a
  `before/after` assertion on `wasm.memory.buffer.byteLength` growing
  bounded).
- [ ] **No regressions**: existing PDB/XYZ load tests still pass —
  the new modifier's `matches()` must not match an atoms-only frame.

---

## Risks & Open Questions

- **Risk**: The current Rust readers use the legacy `Frame::insert_grid`
  API. Migrating them touches every Rust test that asserts
  `frame.get_grid(...)`. → **Mitigation**: tasks 1 and 2 explicitly
  rename those test assertions to `frame.get_block("grid")` in the
  same commit; CI re-runs cargo tests automatically.

- **Risk**: CHGCAR files are big (Fe3O4_spin is 13 MB; eager parse
  produces a Float64Array of 8.7M f64s = 70 MB on the JS heap before
  marching cubes). → **Mitigation**: log a warning when the grid
  exceeds 64³ and add a one-shot info toast in the page. Adaptive
  downsampling for the marching-cubes pass is a follow-up
  (out-of-scope).

- **Risk**: VASP "augmentation occupancies" blocks (the `aug` /
  `augdiff` text after the grid) are currently parsed by `chgcar.rs`
  but never surfaced. → **Mitigation**: keep the existing lenient
  skip behaviour. Augmentation data is irrelevant to the visualiser
  and extracting it can be a future spec.

- **Open question**: Should the spin-difference isosurface render
  with two **separate** modifier instances (one for `+iso`, one for
  `−iso`) or one modifier with `showNegative = true` rendering both?
  → **Recommendation**: one modifier, two meshes. Keeps the pipeline
  list short for the common case; users wanting independent control
  per sign can clone the modifier (when multi-instance support
  lands).

- **Risk**: cube's negative-natoms multi-orbital path is rarely
  documented and easy to mis-parse. After natoms = −N, atoms occupy N
  lines, and the next line has the form `nMO  i₁  i₂  ...  iₙ` (the
  number of orbitals followed by their indices); only then do the
  voxel values start. → **Mitigation**: pin a small parser unit test
  using `grid20mo6-8.cube` (the smallest negative-natoms fixture)
  before wiring the WASM binding.

- **Open question**: Should the basename-match rule apply to *any*
  format whose canonical files have no extension (POTCAR, INCAR
  etc.)? → **Recommendation**: scope this spec to the CHGCAR special
  case; generalise only if a second extensionless format gets
  registered.
