# Extending MolVis

This page shows how to add your own behavior without forking the core.
Most extensions fall into one of four buckets:

| I want to… | Add a… |
|---|---|
| transform frame data before render (hide atoms, recolor, slice) | **Modifier** |
| make an action undoable (a new menu item, a button) | **Command** |
| introduce a new interaction paradigm (like Measure, but for X) | **Mode** |
| draw something new on the canvas (arrows, forces, labels) | **Artist** plugin |

Pick the lowest layer that fits — a *modifier* is cheaper and safer
than a *mode*, and a *command* composes better than direct mutation.

## Modifiers

A `Modifier` is a pure function `(frame, context) → frame`. It never
mutates the input; it returns a new `Frame` derived from the last
block of columns it was handed.

```typescript
import type { Modifier, PipelineContext } from "@molcrafts/molvis-core";
import { ModifierCategory, nextModifierId } from "@molcrafts/molvis-core";
import type { Frame } from "@molcrafts/molvis-core";

interface ScaleXOptions {
  factor: number;
}

export class ScaleXModifier implements Modifier<ScaleXOptions> {
  readonly id = nextModifierId();
  readonly kind = "scale-x";
  readonly category = ModifierCategory.Data;
  readonly label = "Scale X";
  enabled = true;
  options: ScaleXOptions = { factor: 1 };

  apply(frame: Frame, _ctx: PipelineContext): Frame {
    const atoms = frame.getBlock("atoms");
    const x = atoms.copyColF("x");
    for (let i = 0; i < x.length; i++) x[i] *= this.options.factor;

    const next = frame.clone();
    next.getBlock("atoms").setColF("x", x);
    return next;
  }

  inspect(): Record<string, unknown> {
    return { factor: this.options.factor };
  }
}
```

Register it at startup:

```typescript
import { ModifierRegistry } from "@molcrafts/molvis-core";

ModifierRegistry.register("scale-x", () => new ScaleXModifier());
```

Now it shows up in the pipeline's *Add modifier* menu. The registry
decides the **functional group** rendered in the Add menu from the
`category` field:

- `Draw` — rendering layers such as atoms, bonds, boxes, ribbons, and isosurfaces.
- `Selection` — creates or consumes a selection.
- `Geometry` — spatial transforms such as Slice or Wrap PBC.
- `Structure` — topology-related transforms such as Compute Bonds or Hide Hydrogens.
- `Color` — global property coloring.

### Important rules

- **Never mutate the input frame.** Clone first, or compute a new block
  buffer and write it to a fresh frame.
- **Free what you allocate.** WASM `Frame`, `Block`, and `Box` objects
  are manually managed; the pipeline's orchestrator frees intermediate
  frames, so a modifier only needs to worry about its own temporaries.
- **Don't touch the scene.** Modifiers run in the pipeline; scene
  updates happen downstream in the `Artist`. Reading from
  `ctx.sceneIndex` to inform a decision is fine; writing to it is not.

## Commands

A `Command<T>` is an object with `do()` and `undo()`. The registry maps
a string name to a factory; the manager tracks history.

```typescript
import { command, type Command } from "@molcrafts/molvis-core";

interface RotateArgs { axis: [number, number, number]; angle: number; }

@command("rotate_camera")
class RotateCameraCommand implements Command<RotateArgs> {
  private previous?: { alpha: number; beta: number; radius: number };

  do(ctx, args: RotateArgs) {
    const cam = ctx.world.camera;
    this.previous = { alpha: cam.alpha, beta: cam.beta, radius: cam.radius };
    // … apply the rotation
  }

  undo(ctx) {
    if (!this.previous) return;
    ctx.world.camera.alpha = this.previous.alpha;
    ctx.world.camera.beta = this.previous.beta;
    ctx.world.camera.radius = this.previous.radius;
  }
}
```

Execute it:

```typescript
app.execute("rotate_camera", { axis: [0, 0, 1], angle: Math.PI / 4 });
app.commandManager.undo();
```

### `DrawFrameCommand` vs `UpdateFrameCommand`

A single gotcha worth calling out: there are two ways to refresh the
scene, and they do **different** things.

- **`DrawFrameCommand`** — full rebuild. Clears `SceneIndex`, re-creates
  `ImpostorState` buffers, then renders from scratch. Use when the
  topology (atom count, bond count, element types) changes.
- **`UpdateFrameCommand`** — buffer-only update. Writes new positions
  into existing `ImpostorState` buffers. Use when only coordinates
  change between frames of a trajectory.

`UpdateFrameCommand` **must never** call `sceneIndex.registerFrame()` —
that would re-create the buffers and flicker the canvas. Use
`FrameDiff` (`system/frame_diff.ts`) to pick between the two
automatically during trajectory playback.

## Modes

A `Mode` owns the interaction style for one phase of work. It
implements `start()` / `finish()` and typically subscribes to pointer
events.

```typescript
import type { Mode, ModeContext } from "@molcrafts/molvis-core";

export class HighlightMode implements Mode {
  readonly type = "highlight";

  start(ctx: ModeContext) {
    ctx.world.canvas.addEventListener("pointermove", this.onMove);
  }

  finish(ctx: ModeContext) {
    ctx.world.canvas.removeEventListener("pointermove", this.onMove);
  }

  private onMove = (ev: PointerEvent) => { /* … */ };
}

// register during app init
app.modeManager.register(new HighlightMode());
app.setMode("highlight");
```

Modes are mutually exclusive — entering one calls `finish()` on the
previous one first. Keep heavyweight state inside the mode object so
leaving and re-entering is cheap.

## Artist plugins

The `Artist` singleton owns GPU resources for atoms and bonds. To draw
something outside the atom/bond contract — arrows for forces, cages for
clusters, labels — register an **overlay**:

```typescript
import type { OverlaySpec } from "@molcrafts/molvis-core";

const spec: OverlaySpec = {
  id: "com-marker",
  build(ctx) {
    const mesh = /* BabylonJS mesh */;
    return { mesh, dispose: () => mesh.dispose() };
  },
  update(ctx, instance) { /* keep mesh in sync with frame */ },
};

app.overlays.add(spec);
```

Overlays never go through `ImpostorState`; they own their own meshes
and a `dispose()` lifecycle. The `OverlayManager` runs `update` on
every `frame-rendered` event.

## Checklist for a new feature

1. Can I implement it as a pipeline **modifier**? If yes — stop there.
2. If it needs history / undo, wrap the behavior in a **command**.
3. If it needs its own click / drag semantics, introduce a **mode**.
4. If it needs new geometry on the canvas, register an **overlay**.
5. Add a **test**. Mock `SceneIndex` for modifier tests; the command
   test harness is part of `@molcrafts/molvis-core` and runs with
   `rstest`.
6. If it has user-visible controls, add them to the host application
   (the web viewer, the VSCode extension, or your own frontend).
