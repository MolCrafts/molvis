# `@molcrafts/molvis-stage-viewer`

Custom elements `molvis-viewer` and `molvis-style-gallery`. Published
separately from the `@molcrafts/molvis-stage` engine.

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-stage-viewer@0.2.0/dist/main.js"
></script>

<molvis-viewer format="xyz">
  <template data-molvis-source>…</template>
</molvis-viewer>
```

```ts
import "@molcrafts/molvis-stage-viewer";
```

The engine API (`mountMolvis`, pipeline, I/O) stays on
`@molcrafts/molvis-stage`. Bundlers that already import the engine should
call `defineMolvisViewer` from `@molcrafts/molvis-stage-viewer/element`
instead of loading the CDN bundle.

2D docs use `@molcrafts/molvis-sketch-viewer`.

## Build

```bash
npm run build -w @molcrafts/molvis-stage-viewer
```

Page / plugin / vsc-ext builds do not run this.
