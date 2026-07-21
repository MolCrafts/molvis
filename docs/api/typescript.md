# TypeScript API Reference

`@molcrafts/molvis-core` is the TypeScript package that powers every
MolVis frontend. This page documents its public surface. For a guided
introduction see [Development → Extending](../development/extending.md).

## Install

```bash
npm install @molcrafts/molvis-core
```

```typescript
import { mountMolvis, Molvis } from "@molcrafts/molvis-core";
```

MolVis targets modern browsers (ES2022, WebGL2). The Babylon.js engine
is imported as a peer dependency in source; the published bundle
vendors its own copy of `@babylonjs/core` and `@molcrafts/molrs`
(WebAssembly kernels).

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

| Method | Purpose |
|---|---|
| `renderFrame(frame: Frame): void` | Re-render the active frame through the pipeline. Visual style always comes from global app state. |
| `setTrajectory(traj: Trajectory): Promise<void>` | Attach a multi-frame trajectory; the timeline appears automatically. |
| `seekFrame(index: number): void` | Jump to a specific frame in the current trajectory. |

`renderFrame` only draws once the app is running — call `await app.start()`
first, otherwise the render loop is not active and nothing appears.

```typescript
import { readFrame } from "@molcrafts/molvis-core";

const app = mountMolvis(document.getElementById("viewer")!);
await app.start();                       // start() must come first

const frame = readFrame(pdbText, "structure.pdb");
app.renderFrame(frame);
```

To render a single frame as a navigable trajectory instead, wrap it:
`await app.setTrajectory(new Trajectory([frame]))`.

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
| `resetCamera(): void` | Re-fit the camera to the current frame. |
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
const frame = readFrame(pdbText, "structure.pdb");
const atoms = frame.getBlock("atoms");

atoms.nrows();              // number of atoms
atoms.viewColF("x");        // Float64Array — view into WASM memory
atoms.copyColF("x");        // Float64Array — owned copy
atoms.setColStr("element", ["C", "O", "H"]);

frame.box;               // Box | undefined
frame.gridNames();          // string[] of volumetric field names
frame.getGrid("density");   // Grid | undefined

frame.free();
```

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
import { Box } from "@molcrafts/molvis-core";

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
// eager: pre-materialized frames
const traj = new Trajectory([frame0, frame1, frame2], [box0, box1, box2]);

// lazy: backed by a FrameProvider
const provider: FrameProvider = {
  length: frameCount,
  get(index) { return reader.readFrame(index); },
};
const traj = Trajectory.fromProvider(provider);
```

The pipeline and timeline both work with either form. Use the
provider form when the frame count is large and on-demand loading is
needed (e.g. Zarr or LAMMPS dumps).

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
import { command } from "@molcrafts/molvis-core";

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
| `SliceModifier` | Geometry | Keeps atoms inside a half-space. |
| `ExpressionSelectionModifier` | Selection | VMD-style selection expression. |
| `HideSelectionModifier` | Selection | Drops selected atoms from the render. |
| `TransparentSelectionModifier` | Selection | Renders selection with alpha. |
| `ColorByPropertyModifier` | Color | Maps a column to a color ramp. |
| `AssignColorModifier` | Selection | Fixed color on selected atoms. |
| `WrapPBCModifier` | Geometry | Wraps atoms into the primary cell. |

### `ModifierRegistry`

```typescript
import { ModifierRegistry } from "@molcrafts/molvis-core";

ModifierRegistry.register("my-modifier", () => new MyModifier());
ModifierRegistry.list();   // all registered factories
```

## Readers and writers

Format-agnostic helpers:

```typescript
import {
  readFrame, readPDBFrame, readXYZFrame, readLAMMPSData,
  exportFrame, writePDBFrame, writeXYZFrame, writeLAMMPSData,
  inferFormatFromFilename,
} from "@molcrafts/molvis-core";

const frame  = readFrame(content, "a.pdb");
const format = inferFormatFromFilename("a.pdb"); // "pdb"
const text   = writeXYZFrame(frame);
```

For trajectories:

```typescript
import { TrajectoryReader } from "@molcrafts/molvis-core";

const reader = new TrajectoryReader(dumpText, "lammps-dump");
const n      = reader.getFrameCount();
const frame  = reader.readFrame(0);
reader.free();
```

For Zarr directories:

```typescript
import { MolRecReader, processZarrFrame } from "@molcrafts/molvis-core";

const reader = new MolRecReader(fileMap);
const raw    = reader.readFrame(0);
const frame  = processZarrFrame(raw);
reader.free();
```

## Canonical column names

All blocks use canonical column names that match the molpy / molrs
ecosystem. Format readers normalize aliases on the way in.

| Block | Columns |
|---|---|
| `atoms` | `element`, `type`, `id`, `x`/`y`/`z`, `vx`/`vy`/`vz`, `charge`, `mass`, `mol_id`, `res_id`, `res_name` |
| `bonds` | `atomi`, `atomj`, `type`, `order` |
| `angles` | `atomi`, `atomj`, `atomk`, `type` |
| `dihedrals` | `atomi`, `atomj`, `atomk`, `atoml`, `type` |

Reader aliases (`q` → `charge`, `mol` → `mol_id`, `symbol` → `element`,
etc.) are defined in `core/src/reader.ts`. If you add a new format,
extend the alias maps there.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `MOLVIS_VERSION` | Current package version | Version exported by the installed package. |
| `DEFAULT_CONFIG` / `defaultMolvisConfig` | `MolvisConfig` | Default config object. |
| `DEFAULT_SETTING` / `defaultMolvisSettings` | `MolvisSetting` | Default settings object. |

## Runtime notes

Non-obvious behaviors you should know about:

- **`WrapPBCModifier`** validates its input and returns the original
  frame unchanged. The actual PBC wrap is implemented but gated
  pending 0.0.3.
- **`DataSourceModifier`** visibility toggles are UI state only — the
  modifier itself always passes data through.
- **`SetFrameMetaCommand`** is registered but a no-op; it will persist
  frame metadata in 0.0.3.
- **Thin-instance buffers**: the `Artist` owns singleton meshes for
  atoms and bonds. `ImpostorState` segments the buffer into
  `[0, frameOffset)` (frame data) and `[frameOffset, count)` (edit
  pool). `UpdateFrameCommand` only touches the first segment.
