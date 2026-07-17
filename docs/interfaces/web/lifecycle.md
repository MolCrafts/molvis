# Web lifecycle and performance

MolVis owns GPU, DOM, event, and WASM resources. A correct integration treats
lifecycle as part of the API rather than relying on garbage collection.

## Resize the engine

Observe the host, not the global window, because application layouts often
resize without a window event:

```typescript
const observer = new ResizeObserver(() => app.resize());
observer.observe(host);
```

Calling `resize()` updates the drawing buffer and renders immediately, avoiding
a blank frame while a splitter is dragged.

## Pause when hidden

For tab panels or virtualized pages, stop rendering when the view is not
visible and restart when it returns:

```typescript
const visibility = new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) void app.start();
  else app.stop();
});
visibility.observe(host);
```

`stop()` is reversible. `destroy()` is terminal.

## Dispose deterministically

```typescript
function unmountViewer() {
  visibility.disconnect();
  observer.disconnect();
  app.destroy();
}
```

Destroying releases scene meshes/materials, pipeline data sources, overlays,
listeners, and the owned engine. An app configured with an externally shared
engine disposes only its own world; this is how the style gallery keeps one
engine alive while managing multiple scenes.

## Avoid too many WebGL contexts

Browsers limit simultaneous WebGL contexts. Independent `molvis-viewer`
instances each own an engine and are suitable for a few interactive embeds. A
large read-only comparison should use `molvis-style-gallery`, which maps many
visible canvases onto one hidden WebGL canvas.

For deterministic offscreen snapshots and turntables, see
[Headless rendering](../../development/headless-rendering.md).
