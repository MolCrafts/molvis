# `@molcrafts/molvis-sketch-viewer`

CDN bundle and bundler API for the `molvis-sketch` custom element. Published
separately from the `@molcrafts/molvis-sketch` engine.

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-sketch-viewer@0.2.0/dist/main.js"
></script>

<molvis-sketch height="360px"></molvis-sketch>
```

```ts
import "@molcrafts/molvis-sketch-viewer";
```

The engine API (`SketchBoard`, `SketchComposer`) stays on
`@molcrafts/molvis-sketch`. Bundlers that already import the engine should
call `defineMolvisSketch` from `@molcrafts/molvis-sketch-viewer/element`
instead of loading the CDN bundle.

3D docs use `@molcrafts/molvis-stage-viewer`.

## Build

```bash
npm run build -w @molcrafts/molvis-sketch-viewer
```

Page / plugin / vsc-ext builds do not run this.
