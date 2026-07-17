# Install the Web binding

Install the core package in an application that targets modern browsers:

```bash
npm install @molcrafts/molvis-core
```

MolVis expects ES modules, WebAssembly, and WebGL2. Serve the application over
HTTP(S); opening an HTML file directly can prevent module and WASM loading.

## Entry points

The package separates imperative code, file I/O, and side-effecting component
registration:

```typescript
import { mountMolvis, MolvisRenderer } from "@molcrafts/molvis-core";
import { loadFileContent } from "@molcrafts/molvis-core/io";
import "@molcrafts/molvis-core/elements";
```

- The root entry exports application, rendering, analysis, pipeline, and type
  APIs. Importing it does not register custom elements.
- `/io` exports format descriptions, loaders, trajectory sources, and writers.
- `/elements` registers `molvis-viewer` and `molvis-style-gallery` as a browser
  side effect. Import it once per page.

## Use without a bundler

For documentation or a small static page, load the published ESM bundle from
npm (jsDelivr):

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-core@0.1.0/dist/elements.js"
></script>
```

Pin the version in published content.

This manual stages `@molcrafts/molvis-core` from the npm package
(`node_modules/@molcrafts/molvis-core/dist`, including workspace / `npm link`
installs) into the docs asset tree during `zensical serve`. Examples therefore
always exercise the package resolved by npm; the CDN is only a fallback when
the package is not installed.

`@molcrafts/molrs` must be the **wasm-bindgen bundler target** (auto-inits on
import). Web-target (`init()` / `await init()`) builds are not supported.

Continue with [Mount and load](application.md).

