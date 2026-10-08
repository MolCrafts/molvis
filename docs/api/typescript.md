# TypeScript API Reference

`@molcrafts/molvis-stage` is the TypeScript package that powers every
MolVis frontend. This page documents its public surface. For a guided
introduction see [Development → Extending](../development/extending.md).

## Install

```bash
npm install @molcrafts/molvis-stage
```

```typescript
import { mountMolvis, Molvis } from "@molcrafts/molvis-stage";
```

MolVis targets modern browsers (ES2022, WebGL2). The Babylon.js engine
is imported as a peer dependency in source; the published bundle
vendors its own copy of `@babylonjs/*` and reaches `@molcrafts/molrs`
(WebAssembly kernels) only through workspace-private
`@molcrafts/molvis-core/molrs`.

## Entry point

### `mountMolvis(container, config?, settings?): MolvisApp`

Creates a `MolvisApp`, attaches it to `container`, and returns the
instance. The canvas is **not** rendering yet — call `await app.start()`
to begin the render loop.

```typescript
const app = mountMolvis(document.getElementById("viewer")!, {
  showUI: true,
  canvas: { antialias: true },
});
await app.start();
```

### `class Molvis` (alias of `MolvisApp`)

Re-exported for convenience and typing. `mountMolvis` returns a
`Molvis` instance.

## MolvisApp

The orchestrator that owns every subsystem. You rarely construct it
directly — `mountMolvis()` does that for you.

### Lifecycle

| Method | Purpose |
|---|---|
| `start(): Promise<void>` | Boot the render loop and WASM kernels. |
| `resize(): void` | Notify the engine the container changed size. Call from a `ResizeObserver`. |
| `destroy(): void` | Tear down the engine, free WASM resources, detach listeners. |

### Loading structures

Prefer the I/O package for files. App methods act on an already-resolved
`Frame` or `Trajectory`.

| API | Purpose |
|---|---|
| `loadFileContent(app, content, filename, format?, mode?, pickBondMapping?)` from `@molcrafts/molvis-stage/io` | Data-file ingress (replace / augment / extend). Binary formats take `Uint8Array`. |
| `loadMrecSource(app, source, filename, mode?)` from `/io` | Open a `*.mrec` directory or `*.mrec.zip`. Auto-overlays a `frame` section beside a `trajectory`. |
| `loadFileStream(app, blob, filename, format, …)` from `/io` | Stream large text trajectories without materializing the whole file |
| `loadMeshOverlay(app, bytes, filename)` from `/io` | Add an STL triangle mesh as scene geometry — no data source, no frames |
| `sceneDropLoadMode(pipeline)` / `dropLoadMode(sources, meshes?)` | Drop occupancy: empty → replace; sources or meshes → augment |
| `renderFrame(frame: Frame): void` | Draw one frame through the pipeline (style is global app state) |
| `setTrajectory(traj: Trajectory): Promise<void>` | Attach a multi-frame trajectory; timeline appears automatically |
| `seekFrame(index: number): void` | Jump to a trajectory index |

```typescript
import { mountMolvis } from "@molcrafts/molvis-stage";
import {
  loadFileContent,
  loadMeshOverlay,
  loadMrecSource,
  sceneDropLoadMode,
} from "@molcrafts/molvis-stage/io";

const app = mountMolvis(document.getElementById("viewer")!);
await app.start();

await loadFileContent(app, pdbText, "structure.pdb");
```

### Overlay a topology, a trajectory, and a mesh

Drop onto a loaded scene uses `sceneDropLoadMode` (`augment`). Topology
(LAMMPS `.data` / mrec `frame`) and coordinates (DCD / dump / mrec
`trajectory`) compose in either order; rows align by atom `id`. An STL is
never a data source — `loadMeshOverlay` is always additive.

```typescript
await loadFileContent(app, dataText, "sys.data"); // replace
await loadFileContent(app, dcdBytes, "run.dcd", "dcd", "augment");
await loadMeshOverlay(app, stlBytes, "cavity.stl");
```

A `*.mrec` that carries both `frame` and `trajectory` opens both in one
call (`loadMrecSource`) — the same composition without two files.

To concatenate two structures (more atoms, not more frames), use
`mode: "extend"`, not augment.

When you already have a molrs `Frame`, call `app.renderFrame(frame)` after
`start()`. For a navigable single-frame trajectory, use
`await app.setTrajectory(frameToTrajectory(frame))`.

### Global molecular style

MolVis has exactly one molecular representation at a time. Frame and draw
methods accept molecular data only; they never carry a representation, radius,
theme, or outline override.

```typescript
await app.setRepresentation("flat");
await app.setRepresentationOutline(true);
app.renderFrame(frame); // inherits the active global style
```

`setRepresentationOutline()` is valid only for `flat`, `skeletal`, and
`graph`. Their heavy outline expands the shader silhouette outside the
original atom or bond and adapts its ink color to the scene background.

The representation IDs are:

```typescript
type RepresentationId =
  | "ball-and-stick"
  | "flat"
  | "ball-and-tube"
  | "tube"
  | "metal-tube"
  | "wireframe"
  | "bubble"
  | "spacefill"
  | "skeletal"
  | "graph";
```

See [Molecular representations](../tutorial/representations.md) for the visual contract
of every preset.

### Volumetric rendering

`DrawIsosurfaceModifier` separates geometry mode from surface treatment:

```typescript
modifier.setStyle({
  renderMode: "both",       // "surface" | "cloud" | "both"
  surfaceStyle: "contour", // "solid" | "mesh" | "contour" | "dot"
  contourSpacing: 0.45,
  cloudThreshold: 0.12,
  cloudStride: 2,
});
await app.applyPipeline({ fullRebuild: true });
```

Surface settings belong to that isosurface modifier; they do not create a
second atom/bond representation.

### Interaction

| Method | Purpose |
|---|---|
| `setMode(mode: "view" \| "select" \| "edit" \| "manipulate" \| "measure"): void` | Switch the active mode. |
| `fit(): void` | Fit the camera to the current scene (empty → home pose). |
| `setConfig(config: Partial<MolvisConfig>): void` | Apply a config delta. |
| `save(): Promise<void>` | Trigger export. In the browser this downloads; in VSCode it writes through the extension host. |

### Pipeline

| Accessor | Purpose |
|---|---|
| `app.pipeline: ModifierPipeline` | The modifier chain driving rendering. Append, re-order, or remove modifiers here. |
| `app.applyPipeline(): void` | Recompute the pipeline synchronously (usually unnecessary; changes auto-apply). |

### Events

```typescript
app.events.on("frame-change", ({ index }) => { /* … */ });
app.events.on("selection-change", ({ atoms, bonds }) => { /* … */ });
```

Event keys:

| Key | Payload |
|---|---|
| `frame-change` | `{ index: number }` |
| `frame-rendered` | `{ index: number }` |
| `trajectory-change` | `{ length: number }` |
| `mode-change` | `{ from: string; to: string }` |
| `selection-change` | `{ atoms: number[]; bonds: number[] }` |
| `dirty-change` | `boolean` |
| `history-change` | `{ canUndo: boolean; canRedo: boolean }` |

## Configuration types

### `MolvisConfig`

Passed once at `mountMolvis` time. Missing keys fall back to
`defaultMolvisConfig`.

```typescript
interface MolvisConfig {
  showUI?: boolean;
  useRightHandedSystem?: boolean;
  ui?: {
    showInfoPanel?: boolean;
    showModePanel?: boolean;
    showViewPanel?: boolean;
    showPerfPanel?: boolean;
    showTrajPanel?: boolean;
    showContextMenu?: boolean;
  };
  canvas?: {
    antialias?: boolean;
    alpha?: boolean;
    preserveDrawingBuffer?: boolean;
    stencil?: boolean;
  };
}
```

### `MolvisSetting`

Runtime state. Each setter emits a `settings-change` event.

```typescript
interface MolvisSetting {
  cameraPanSpeed: number;
  cameraRotateSpeed: number;
  cameraZoomSpeed: number;
  cameraInertia: number;
  cameraPanInertia: number;
  cameraMinRadius: number;
  cameraMaxRadius: number | null;
  grid: {
    enabled: boolean;
    mainColor: string;
    lineColor: string;
    opacity: number;
    majorUnitFrequency: number;
    minorUnitVisibility: number;
    size: number;
  };
  graphics: {
    shadows: boolean;
    postProcessing: boolean;
    ssao: boolean;
    bloom: boolean;
    ssr: boolean;
    dof: boolean;
    fxaa: boolean;
    hardwareScaling: number;
  };
}
```

## Data layer

The data layer is re-exported from the `@molcrafts/molrs` WASM package.
These classes own WASM memory; call `.free()` on any instance you
create yourself.

### `Frame`

```typescript
import { readFrames } from "@molcrafts/molvis-stage/io";

const frames = readFrames(pdbText, "structure.pdb");
const frame = frames[0]!;
const atoms = frame.get("atoms");  // throws if absent — test frame.has("atoms")

atoms.nRows;                // number of atoms
atoms.view("x");            // Float64Array — view into WASM memory
atoms.copy("x");            // Float64Array — owned copy
atoms.set("element", ["C", "O", "H"]);

frame.box;                  // Box | undefined
frame.has("grid");          // volumetric fields live in the "grid" block
frame.get("grid").structuralShape; // [nx, ny, nz]

frame.free();
```

For full scene install (data source + pipeline), use `loadFileContent` instead
of parsing frames by hand.

### `Block`

Column-oriented storage. `set(name, data)` takes the column's array, and the
array type is the column's dtype (`block.dtype(name)`):

| Array | dtype | Columns |
|---|---|---|
| `Float64Array` | `float` | all floating columns |
| `Int32Array` | `int` | signed ints |
| `BigUint64Array` | `uint` | identifiers and endpoints (`id`, `type_id`, `atomi`) |
| `string[]` | `string` | string columns (`element`, `res_name`) |

Getters come in two flavors:

| Getter | Returns |
|---|---|
| `view(name)` | Zero-copy view — invalidated on the next WASM call |
| `copy(name)` | Owned copy — safe to keep |

Use views in hot paths (renderer, pipeline) and copies when storing
across frames.

### `Box`

```typescript
import { Box } from "@molcrafts/molvis-stage";

const cubic     = Box.cube(10.0, [0, 0, 0], true, true, true);
const ortho     = Box.ortho(
  new Float64Array([10, 20, 30]),
  new Float64Array([0, 0, 0]),
  true, true, true,
);
const triclinic = new Box(hMatrix, origin, true, true, true);

cubic.free();
```

### `Trajectory`

Multi-frame container. Two construction modes:

```typescript
import { Trajectory, type FrameProvider } from "@molcrafts/molvis-stage";
import { loadTextTrajectory } from "@molcrafts/molvis-stage/io";

// From a text file body (disposes the underlying reader when you call dispose)
const { trajectory, dispose } = loadTextTrajectory(dumpText, "traj.dump");
await app.setTrajectory(trajectory);

// Eager: pre-materialized frames
const traj = new Trajectory([frame0, frame1, frame2]);

// Lazy: FrameProvider (large streams / Zarr)
const provider: FrameProvider = {
  length: frameCount,
  get(index) {
    return trajectory.get(index);
  },
};
const lazy = Trajectory.fromProvider(provider);
```

Prefer `loadFileContent` / `loadFileStream` for ordinary product loads so the
pipeline head stays a proper data source.

## Commands

### `CommandManager`

```typescript
app.execute("draw_frame", { frame });
app.commandManager.undo();
app.commandManager.redo();
```

Built-in commands:

| Name | Purpose |
|---|---|
| `draw_frame` | Full scene rebuild for a frame. |
| `update_frame` | In-place buffer update for a frame (playback). |
| `clear` | Drop all scene entities. |
| `set_attribute` | Change a per-atom or per-bond attribute. |
| `select_*` | Selection operations (add, toggle, invert, expression). |
| `add_modifier`, `remove_modifier`, `reorder_modifier` | Pipeline edits. |
| `add_overlay`, `remove_overlay` | Overlay lifecycle. |

### Registering a new command

Annotate a class with `@command(name)`:

```typescript
import { command } from "@molcrafts/molvis-stage";

@command("my_action")
class MyActionCommand implements Command<MyArgs> {
  do(ctx, args) { /* … */ }
  undo(ctx)     { /* … */ }
}
```

See [Extending → Commands](../development/extending.md#commands).

## Pipeline

### `ModifierPipeline`

```typescript
app.pipeline.add(new SliceModifier());
app.pipeline.remove(id);
app.pipeline.move(id, newIndex);
app.pipeline.setEnabled(id, false);
```

### Built-in modifiers

| Class | Category | What it does |
|---|---|---|
| `DataSourceModifier` | Data | Selects which trajectory slice feeds the pipeline. |
| `ExpressionSelectionModifier` | Selection | VMD-style selection expression. |
| `ClearSelectionModifier` | Selection | Empty selection (OVITO clear; not select-all). |
| `InvertSelectionModifier` | Selection | Complement of current selection. |
| `SelectTypeModifier` | Selection | Multi-select by `element` / `type` columns. |
| `ExpandSelectionModifier` | Selection | Grow selection by bonds and/or cutoff neighbors. |
| `SelectOverlappingModifier` | Selection | Atoms with a neighbor within cutoff. |
| `SliceModifier` | Modification | Keeps atoms inside a half-space. |
| `AffineTransformationModifier` | Modification | x′ = M·x + t; optional cell transform. |
| `ReplicateModifier` | Modification | Tile images along cell vectors. |
| `UnwrapTrajectoriesModifier` | Modification | Remove PBC jumps across frames. |
| `SmoothTrajectoryModifier` | Modification | Sliding-window coordinate average. |
| `ComputePropertyModifier` | Modification | Expression → per-atom float column. |
| `FreezePropertyModifier` | Modification | Freeze a column across frames. |
| `EditTypesModifier` | Modification | Set element/type on selection. |

| `HideSelectionModifier` | Modification | Drops selected atoms from the render. |
| `DeleteSelectedModifier` | Modification | Removes selected atoms from the frame. |
| `ColorByPropertyModifier` | Coloring | Maps a column to a color ramp. |
| `ColorByTypeModifier` | Coloring | Categorical color by `element` (OVITO Color by Type). |
| `AssignColorModifier` | Coloring | Fixed color on selected atoms. |
| `SteinhardtOrderModifier` | Structure identification | Writes `steinhardt_q{l}`; optional scene color. |
| `SolidLiquidModifier` | Structure identification | Writes `solid_liquid` / `solid_liquid_n_bonds`; optional color. |
| `DisplacementVectorsModifier` | Analysis | Displacement.X/Y/Z vs reference frame. |
| `BondColumnRemapModifier` | Modification | Maps dump-local endpoint columns to `atomi`/`atomj`. Loader-attached, not in the Add menu. |
| `MeshOverlayModifier` | Visualization | Imported STL. Not a data source; not user-addable (`loadMeshOverlay`). |
| `ComputeBondsModifier` | Visualization | Create bonds (perceive topology). |
| `DrawBondModifier` | Visualization | **Bonds** visual element (user-addable). |
| `DrawBoxModifier` | Visualization | **Simulation cell** (user-addable). |
| `HideSelectionModifier` | Selection | Hide atoms in the current selection. |

Auto-attach visual elements (`Particles`, `Cartoon`, `Isosurface`) and
`TransparentSelectionModifier` remain registered for load / programmatic use
but are not listed in the Add-modifier menu.

### `ModifierRegistry`

```typescript
import { ModifierRegistry } from "@molcrafts/molvis-stage";

// register(name, category, factory, options?)
ModifierRegistry.register("my-modifier", "Modification", () => new MyModifier());

// Kept for load / RPC resolution but omitted from the Add-modifier menu:
ModifierRegistry.register("my-overlay", "Visualization", () => new MyOverlay(), {
  userAddable: false,
});

ModifierRegistry.getAvailableModifiers();   // every registered entry
ModifierRegistry.getUserAddableModifiers(); // only those in the Add menu
ModifierRegistry.unregister("my-modifier");
```

`category` is required and must be one of `MODIFIER_CATEGORIES`: `"Selection"`,
`"Modification"`, `"Coloring"`, `"Structure identification"`, `"Visualization"`,
`"Analysis"`. Omitting it registers the modifier with no category, and it will
not appear in the Add-modifier menu.

## Readers and writers

I/O lives on the `@molcrafts/molvis-stage/io` subpath (and
`@molcrafts/molvis-stage/io/formats` for the format registry).

### File ingress

```typescript
import {
  loadFileContent,
  loadFileStream,
  loadTextTrajectory,
  readFrames,
  inferFormatFromFilename,
  writeFrame,
} from "@molcrafts/molvis-stage/io";

// Install into the live scene (pipeline + data source)
await loadFileContent(app, content, "a.pdb");
// mode: "replace" | "augment" | "extend"

// Parse without mounting
const frames = readFrames(content, "a.pdb");
const format = inferFormatFromFilename("a.pdb"); // "pdb"

// Serialize
const payload = writeFrame(frame, { filename: "out.pdb" });
const xyz = writeFrame(frame, { format: "xyz" }).content;
```

### Large trajectories

```typescript
// Stream from a Blob (worker indexes byte ranges; never one giant string)
await loadFileStream(app, fileBlob, "traj.dump", "lammps-dump", {
  onProgress: (p) => console.log(p),
});

// Or materialize a Trajectory from a text body
const { trajectory, dispose } = loadTextTrajectory(dumpText, "traj.dump");
await app.setTrajectory(trajectory);
// later: dispose();
```

### mrec stores

An `*.mrec` store is a Zarr-v3 directory — or its packed single-file form,
`*.mrec.zip` (stored entries) — that molrs opens as a trajectory. `mrec` is
the product name; `zarr` is only the on-disk encoding. `mrec` is deliberately
not a `FileFormat` — hosts recognise the store folder / archive
(`mrecStoreRootPath`, `isMrecZipPath` in `@molcrafts/molvis-stage/io/formats`)
and hand it to the store ingress; they never route its bytes to a
per-extension parser.

`loadMrecSource` is that ingress. When Workers exist the molrs
`MrecReader` runs inside the trajectory worker and only the byte ranges a
frame touches ever cross into wasm; otherwise the store opens on the main
thread. Either way it lands in the pipeline's single ingress.

```typescript
import {
  loadFileContent,
  loadMrecSource,
  type MrecDirectorySource,
  type MrecStoreInput,
} from "@molcrafts/molvis-stage/io";

// Whole store already in memory (path → bytes, or base64 on old transports):
await loadFileContent(app, fileMap, "dataset.mrec");
// …or the same shape spelled as a store input:
await loadMrecSource(app, { kind: "files", files }, "dataset.mrec");

// Browser File handles of the store directory (showDirectoryPicker / a
// dropped folder) — the lazy door: nothing but touched chunks leaves disk.
const tree: MrecStoreInput = { kind: "file-tree", files: keyToFile };
await loadMrecSource(app, tree, "dataset.mrec");

// A packed archive is one File / Blob.
await loadMrecSource(app, { kind: "zip", blob: zipFile }, "dataset.mrec.zip");

// Hosts that can list/read a directory (molexp workspace.fs, vscode.workspace.fs)
// hand an MrecDirectorySource; it is walked into memory first.
const source: MrecDirectorySource = { list, read };
await loadMrecSource(app, source, "dataset.mrec");
```

Frames of an mrec trajectory expose the store's per-block update ids through
`Trajectory.sectionUpdates(index)`; the playback classifier uses them to keep a
position-only redraw whenever no topology block changed.

> The former encoding-named exports (`loadZarrStore`, `loadZarrFiles`,
> `loadZarrSource`, `loadZarrDirectory`, `collectZarrDirectory`,
> `ZarrDirectorySource`, `ZarrDirent`, `ZarrLoadResult`) remain as
> `@deprecated` aliases for one release; prefer the `mrec*` / `Mrec*` names.

### STL meshes

An `*.stl` triangle mesh is scene *geometry*, not scene data: it carries no
atoms, no cell and no frames, so — like `mrec`, and for the opposite reason —
it is deliberately not a `FileFormat`. Hosts recognise it with `isStlPath`
(`@molcrafts/molvis-stage/io/formats`) and hand the bytes to `loadMeshOverlay`;
they never route them to a `Frame` reader.

molrs owns the parse (`molrs::io::mesh::stl` → `readSTL` in wasm, reached
through `@molcrafts/molvis-core/molrs`'s `readStlMesh`) — the same reader
molpack's `StlRegion` uses, so the container a packing run was confined to and
the container molvis draws are read by one implementation. The wasm `Mesh`
never escapes the gateway: its arrays are copied out and it is freed before
`readStlMesh` returns, so a mesh costs one decode and no live handle. That is
affordable because it happens once per file — a *computed* surface (marching
cubes, molecular surface) is re-derived every pipeline pass and stays in JS.

The load is additive and has no `LoadMode`: the mesh becomes a `Mesh`
(`MeshOverlayModifier`) plus the `Draw surface` companion the pipeline pairs
with every geometry producer, and never a `DataSource`. Because its triangles
come from the file rather than from the frame, every pipeline pass republishes
the same geometry — the mesh stands still while the trajectory plays inside it,
and seeking or stacking a topology file on top leaves it alone.

```typescript
import { loadMeshOverlay } from "@molcrafts/molvis-stage/io";

await loadMeshOverlay(app, new Uint8Array(await file.arrayBuffer()), file.name);
```

Both STL shapes are accepted: a length-matched binary file (`84 + 50n` bytes)
first, otherwise ASCII starting with `solid`. Normals are computed from each
facet's winding — the recorded facet normal is ignored, since writers
(molpack's included) routinely emit `0 0 0`. Appearance — colour, opacity,
`solid`/`mesh`/`contour`/`dot` finish — belongs to the paired `Draw surface`,
so restyling never re-reads the file.

Geometry is not written into a saved project: a restored `Mesh` row remembers
the file it came from and paints nothing until that file is opened again.

## Canonical column names

Blocks use molpy / molrs names. Format readers normalize aliases on the way in.

| Block | Columns |
|---|---|
| `atoms` | `element`, `type`, `id`, `x`/`y`/`z`, `vx`/`vy`/`vz`, `charge`, `mass`, `mol_id`, `res_id`, `res_name` |
| `bonds` | `atomi`, `atomj`, `type`, `order` |
| `angles` | `atomi`, `atomj`, `atomk`, `type` |
| `dihedrals` | `atomi`, `atomj`, `atomk`, `atoml`, `type` |

## Constants

| Name | Value | Meaning |
|---|---|---|
| `MOLVIS_VERSION` | Current package version | Version exported by the installed package. |
| `DEFAULT_CONFIG` / `defaultMolvisConfig` | `MolvisConfig` | Default config object. |
| `DEFAULT_SETTING` / `defaultMolvisSettings` | `MolvisSetting` | Default settings object. |

## Runtime notes

- **Single scene path** — open / reset is an empty pipeline plus a length-1
  empty trajectory. File load, sketch commit, and box ops stay on
  `DataSource(s) → compose → transforms → draws` when sources exist.
- **Manual `DrawBoxModifier`** writes the user-defined cell onto `frame.box`
  (frame data, not only a wireframe). Geometry transforms run before Draw
  modifiers so the visual sees transformed positions. Its **Wrap** switch
  sets pipeline `wrapEnabled` (post-compose `Box.wrap` on atom columns;
  edge bonds use draw-time MI).
- **`DataSourceModifier`** visibility toggles are UI state only — the
  modifier always passes data through.
- **Canvas selection is SceneIndex** — pick / fence / live selection resolve
  against the rendered index, not a ghost of the trajectory HEAD.
- **Thin-instance buffers** — the `Artist` owns singleton meshes for atoms
  and bonds. A `changeKind: "position"` pipeline pass updates buffer data
  only; `changeKind: "full"` rebuilds the scene.
