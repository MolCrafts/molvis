# Embedding

`@molcrafts/molvis-stage` is the TypeScript engine behind every MolVis
frontend. Mounting it in your own app takes a container element and
two calls.

## Install

```bash
npm install @molcrafts/molvis-stage
```

The published package is ESM-only, targets ES2022, and vendors its
own copy of Babylon.js. WASM kernels arrive via
`@molcrafts/molvis-core/molrs` (transitive; do not import
`@molcrafts/molrs` directly).

## Minimal example

```html
<div id="viewer" style="width: 100vw; height: 100vh;"></div>
```

```typescript
import { mountMolvis } from "@molcrafts/molvis-stage";

const container = document.getElementById("viewer");
if (!container) throw new Error("viewer container not found");

const app = mountMolvis(container);
await app.start();
```

`mountMolvis` returns a `MolvisApp` instance. The canvas is created
and appended to the container, but the render loop is not running
yet — `start()` boots the loop and initializes the WASM kernels.

## Loading a structure

All file ingress goes through `loadFileContent` (replace / augment / extend).
It installs a primary data source, runs the pipeline, and fits the camera.

```typescript
import { loadFileContent } from "@molcrafts/molvis-stage/io";

const text = await fetch("/structure.pdb").then((r) => r.text());
await loadFileContent(app, text, "structure.pdb");
```

Binary formats take a `Uint8Array`. Large text trajectories can use
`loadFileStream` with a `Blob` so the full file is never held as one string.

See the [TypeScript API reference](../api/typescript.md) for I/O helpers
(`readFrames`, `writeFrame`, format registry) and `renderFrame` when you
already hold a molrs `Frame`.

## Configuration

Two optional arguments customize the app:

```typescript
import type { MolvisConfig, MolvisSetting } from "@molcrafts/molvis-stage";

const config: MolvisConfig = {
  showUI: false,             // hide every overlay UI element
  canvas: { antialias: true, alpha: false },
};

const settings: Partial<MolvisSetting> = {
  cameraZoomSpeed: 1.5,
  grid: { enabled: true, opacity: 0.3 },
};

const app = mountMolvis(container, config, settings);
```

`MolvisConfig` is applied once at mount time (`showUI`, coordinate
system, canvas creation options). `MolvisSetting` is runtime state
(camera speeds, grid colors, post-processing toggles). Both are
documented in full in the
[TypeScript API reference](../api/typescript.md#configuration-types).

## Reacting to events

```typescript
app.events.on("frame-change",    ({ index }) => updateStatusBar(index));
app.events.on("selection-change", ({ atoms }) => updateInspector(atoms));
```

See the [Events table](../api/typescript.md#events) for the full list.

## Tearing down

When your component unmounts, call `destroy()`:

```typescript
app.destroy();
```

This disposes the Babylon.js engine, frees WASM-backed frames, and
detaches every event listener. `mountMolvis` can be called again on
a fresh container afterwards.

## Resizing

The viewport does not auto-resize; notify it whenever the container
changes size:

```typescript
const observer = new ResizeObserver(() => app.resize());
observer.observe(container);
```

## React integration

A minimal React wrapper:

```tsx
import { useEffect, useRef, useState } from "react";
import { mountMolvis, type Molvis } from "@molcrafts/molvis-stage";

export function MolVisView({ pdb }: { pdb: string }) {
  const ref        = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<Molvis | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = mountMolvis(ref.current);
    setApp(instance);
    void instance.start();

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    if (!app) return;
    void import("@molcrafts/molvis-stage/io").then(({ loadFileContent }) =>
      loadFileContent(app, pdb, "structure.pdb"),
    );
  }, [app, pdb]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
```

## Next step

See [Extending](extending.md) for how to add custom modifiers,
commands, modes, and overlays.
