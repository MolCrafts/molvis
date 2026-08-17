# `@molcrafts/molvis-stage`

3D stage engine for MolVis: Babylon.js rendering, commands, modes, OVITO-shaped
modifier pipeline, selection, and JSON-RPC.

## Install

```bash
npm install @molcrafts/molvis-stage
```

Need 2D as well? Install `@molcrafts/molvis` (root umbrella) or add
`@molcrafts/molvis-sketch` alongside stage.

## Quick start

```ts
import { mountMolvis } from "@molcrafts/molvis-stage";
import { loadFileContent } from "@molcrafts/molvis-stage/io";

const container = document.getElementById("viewer");
if (!container) throw new Error("viewer container not found");

const app = mountMolvis(container);
await app.start();

const pdbText = await (await fetch("/structure.pdb")).text();
await loadFileContent(app, pdbText, "structure.pdb");
```

Entry points:

| Import | Role |
|--------|------|
| `@molcrafts/molvis-stage` | Application, rendering, analysis, pipeline, types |
| `@molcrafts/molvis-stage/io` | Format loaders, trajectory sources, writers |
| `@molcrafts/molvis-stage/export-gltf` | Binary glTF (`.glb`) export (`exportFrameToGLB`). Not on the root barrel. |

Custom elements live in `@molcrafts/molvis-stage-viewer` (`dist/main.js` CDN,
`./element` for bundlers). Page / plugin builds do not compile it. 2D docs
use `@molcrafts/molvis-sketch-viewer`.

## Dev commands

```bash
npm run build -w @molcrafts/molvis-stage          # engine library (page / plugin)
npm run build -w @molcrafts/molvis-stage-viewer   # 3D CDN custom elements
npm run dev -w @molcrafts/molvis-stage
npm run test -w @molcrafts/molvis-stage
npm run release:check -w @molcrafts/molvis-stage
```

## Related packages

| Package | Role |
|---------|------|
| `@molcrafts/molvis-stage` | This package — 3D engine |
| `@molcrafts/molvis-stage-viewer` | 3D CDN custom elements (`molvis-viewer`) |
| `@molcrafts/molvis-sketch-viewer` | 2D CDN custom element (`molvis-sketch`) |
| `@molcrafts/molvis-sketch` | 2D sketcher |
| `@molcrafts/molvis` | Root umbrella (stage + sketch re-exports) |
| `@molcrafts/molvis-core` | Shared molrs gateway + element data (transitive) |

## License

BSD-3-Clause. See [LICENSE](./LICENSE).