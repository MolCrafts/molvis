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
| `loadFileContent(app, content, filename, format?, mode?)` from `@molcrafts/molvis-stage/io` | Canonical file ingress (replace / augment / extend) |
| `loadFileStream(app, blob, filename, format, …)` from `/io` | Stream large text trajectories without materializing the whole file |
| `renderFrame(frame: Frame): void` | Draw one frame through the pipeline (style is global app state) |
| `setTrajectory(traj: Trajectory): Promise<void>` | Attach a multi-frame trajectory; timeline appears automatically |
| `seekFrame(index: number): void` | Jump to a trajectory index |

```typescript
import { mountMolvis } from "@molcrafts/molvis-stage";
import { loadFileContent } from "@molcrafts/molvis-stage/io";

const app = mountMolvis(document.getElementById("viewer")!);
await app.start();

await loadFileContent(app, pdbText, "structure.pdb");
```

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
const atoms = frame.getBlock("atoms");

atoms.nrows();              // number of atoms
atoms.viewColF("x");        // Float64Array — view into WASM memory
atoms.copyColF("x");        // Float64Array — owned copy
atoms.setColStr("element", ["C", "O", "H"]);

frame.box;                  // Box | undefined
frame.gridNames();          // string[] of volumetric field names
frame.getGrid("density");   // Grid | undefined

frame.free();
```

For full scene install (data source + pipeline), use `loadFileContent` instead
of parsing frames by hand.

### `Block`

Column-oriented storage. Column setters accept typed arrays:

| Setter | Accepts |
|---|---|
| `setColF(name, Float64Array)` | all floating columns |
| `setColI32(name, Int32Array)` | signed 32-bit ints (e.g. `type_id`) |
| `setColU32(name, Uint32Array)` | unsigned 32-bit ints (e.g. `id`) |
| `setColStr(name, string[])` | string columns (`element`, `res_name`) |

Getters come in two flavors:

| Getter | Returns |
|---|---|
| `viewColF(name)` | Zero-copy view — invalidated on the next WASM call |
| `copyColF(name)` | Owned copy — safe to keep |

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
| `WrapPBCModifier` | Modification | Wraps atoms into the primary cell. |
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
| `ComputeBondsModifier` | Visualization | Create bonds (perceive topology). |
| `DrawBondModifier` | Visualization | **Bonds** visual element (user-addable). |
| `DrawBoxModifier` | Visualization | **Simulation cell** (user-addable). |
| `HideSelectionModifier` | Selection | Hide atoms in the current selection. |

Auto-attach visual elements (`Particles`, `Cartoon`, `Create isosurface`) and
`TransparentSelectionModifier` remain registered for load / programmatic use
but are not listed in the Add-modifier menu.

### `ModifierRegistry`

```typescript
import { ModifierRegistry } from "@molcrafts/molvis-stage";

ModifierRegistry.register("my-modifier", () => new MyModifier());
ModifierRegistry.list();   // all registered factories
```

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
  writeXYZFrame,
  writePDBFrame,
  writeLAMMPSData,
} from "@molcrafts/molvis-stage/io";

// Install into the live scene (pipeline + data source)
await loadFileContent(app, content, "a.pdb");
// mode: "replace" | "augment" | "extend"

// Parse without mounting
const frames = readFrames(content, "a.pdb");
const format = inferFormatFromFilename("a.pdb"); // "pdb"

// Serialize
const text = writeXYZFrame(frame);
const payload = writeFrame(frame, { filename: "out.pdb" });
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

### Zarr

```typescript
import { loadFileContent, loadZarrFiles } from "@molcrafts/molvis-stage/io";

// fileMap: path → base64 (or pass the map straight to loadFileContent)
await loadFileContent(app, fileMap, "dataset.zarr", "zarr");
```

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
  modifiers so the visual sees transformed positions.
- **`WrapPBCModifier`** wraps atom coordinates into `frame.box`.
- **`DataSourceModifier`** visibility toggles are UI state only — the
  modifier always passes data through.
- **Canvas selection is SceneIndex** — pick / fence / live selection resolve
  against the rendered index, not a ghost of the trajectory HEAD.
- **Thin-instance buffers** — the `Artist` owns singleton meshes for atoms
  and bonds. A `changeKind: "position"` pipeline pass updates buffer data
  only; `changeKind: "full"` rebuilds the scene.
