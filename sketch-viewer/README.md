# `@molcrafts/molvis-sketch-viewer`

CDN bundle and bundler API for the `molvis-sketch` custom element. Published
separately from the `@molcrafts/molvis-sketch` engine.

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-sketch-viewer@0.4.0/dist/main.js"
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

## Standalone Sketch editor

The editor shipped with Python (`molvis sketch MOLECULE`) has an optional
linked 3D pane. It starts closed. Click **3D** in the top toolbar, or
right-click the drawing and choose **Show 3D structure**, to open Stage on
the right. The same controls or the pane's close button hide it again.
Drag the divider, or focus it and use the arrow keys, to resize the views.
Narrow windows stack them vertically.

Stage starts in Edit mode: drag empty space to rotate the view, drag from an
atom to grow a bond and a new atom, or drag onto another atom to connect it.
An empty-space click places one atom; a drag never creates a separate fragment.

Both views edit the same connectivity. Atom and bond changes propagate in
either direction; moving the 2D drawing or navigating 3D does not rebuild
the other view. A 2D connectivity change generates a new 3D conformation;
a 3D connectivity change lays out a coherent new 2D depiction with the
current drawing colors. Closing the pane releases Stage and retains a
snapshot of its conformation for reopening
as long as the 2D connectivity is unchanged. Failed generation leaves the
drawing intact and offers **Retry**.

Wedge-bond stereochemistry does not yet have a chiral-reference export from
Sketch. Linked 3D reports that limitation and keeps the 2D drawing instead
of silently generating an unspecified stereoisomer.

This composition belongs to the standalone editor host. The custom-element
CDN bundle, read-only previews and canvas-only PNG exports stay 2D; Stage's
code loads only after the editor's 3D control is activated.

## Build

```bash
npm run build -w @molcrafts/molvis-sketch-viewer
```

Page / plugin / vsc-ext builds do not run this.
