# Install the Web binding

Install both engines via the root umbrella, or pick a single surface:

```bash
# 3D + 2D
npm install @molcrafts/molvis

# 3D only
npm install @molcrafts/molvis-stage

# 2D only
npm install @molcrafts/molvis-sketch
```

MolVis expects ES modules, WebAssembly, and WebGL2. Serve the application over
HTTP(S); opening an HTML file directly can prevent module and WASM loading.

## Entry points

The stage package separates imperative code, file I/O, and side-effecting
component registration:

```typescript
import { mountMolvis, MolvisRenderer } from "@molcrafts/molvis-stage";
import { loadFileContent } from "@molcrafts/molvis-stage/io";
import "@molcrafts/molvis-stage/viewer";
```

- The root entry exports application, rendering, analysis, pipeline, and type
  APIs. Importing it does not register custom elements.
- `/io` exports format descriptions, loaders, trajectory sources, and writers.
- `/viewer` registers `molvis-viewer` and `molvis-style-gallery` as a browser
  side effect. Import it once per page.

Shared WASM and pure element data live in the monorepo package
`@molcrafts/molvis-core` (not a separate product install for app authors — it is
pulled in transitively via stage/sketch).

## Use without a bundler

For documentation or a small static page, load the published ESM viewer bundle
from npm (jsDelivr):

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-stage@0.2.0/dist/main.js"
></script>
```

Pin the version in published content.

This manual stages `@molcrafts/molvis-stage` from the npm package
(`node_modules/@molcrafts/molvis-stage/dist`, including workspace / `npm link`
installs) into the docs asset tree during `zensical serve`. Examples therefore
always exercise the package resolved by npm; the CDN is only a fallback when
the package is not installed.

`@molcrafts/molrs` is reached only through `@molcrafts/molvis-core/molrs`
(wasm-bindgen **bundler target**, auto-inits on import). Web-target
(`init()` / `await init()`) builds are not supported.

Continue with [Mount and load](application.md).
