# Mount and load a Web application

An imperative Web integration has three explicit phases: create the app, load a
source, and start/observe its lifecycle.

## Create a container

MolVis sizes its canvas from the host element, so the element must have a real
height:

```html
<div id="viewer"></div>

<style>
  #viewer {
    width: 100%;
    height: 70vh;
    min-height: 420px;
  }
</style>
```

## Mount the application

```typescript
import { mountMolvis } from "@molcrafts/molvis-core";
import { loadFileContent } from "@molcrafts/molvis-core/io";

const host = document.querySelector<HTMLElement>("#viewer")!;
const app = mountMolvis(host, {
  showUI: true,
  canvas: { antialias: true },
});

await app.start();
```

`mountMolvis` creates one `MolvisApp`, BabylonJS engine, world, pipeline, and UI
inside the container. `start()` is idempotent and begins the render loop.

## Load a text structure

```typescript
const response = await fetch("/structures/aspirin.sdf");
if (!response.ok) throw new Error(`HTTP ${response.status}`);

const sdf = await response.text();
await loadFileContent(app, sdf, "aspirin.sdf", "sdf");
await app.setRepresentation("ball-and-stick");
app.resetCamera();
```

The loader constructs a trajectory/data source, attaches the default drawing
modifiers, and runs the pipeline. Use `Uint8Array` for binary formats and the
Zarr helpers for directory-backed trajectories.

## Respond to state

```typescript
const removeModeListener = app.events.on("mode-change", (mode) => {
  console.log("active mode:", mode);
});
```

Keep ownership clear: the code that mounts the app should also call
`removeModeListener()`, remove its other event listeners, and call
`app.destroy()`.

Continue with [Web Components](components.md) for declarative embeds.
