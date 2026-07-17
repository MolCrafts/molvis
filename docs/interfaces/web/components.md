# Web Components and formatter fences

Web Components are appropriate when document content declares a molecular view
but should not manage `MolvisApp` directly. Importing the elements bundle
registers the tags.

## Prefer a formatter in Markdown

The `molvis` formatter validates its attributes and safely stores inline source
inside the generated component:

````markdown
```molvis {format="xyz" controls="view trajectory"}
3
name=water Connct="[0,1,0,2]"
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
```
````

Author-facing options include `format`, `controls`, `modes`, `mode`,
`representation`, `background`, `width`, and `height`. View mode is always
retained as a safe fallback.

## Representation gallery

The `molvis-gallery` formatter accepts one `src` or one inline molecular source
and renders a card for every requested representation:

````markdown
```molvis-gallery {src="../assets/aspirin.sdf" format="sdf" representations="flat skeletal graph" rotation-speed="0.06"}
```
````

Omitting `representations` uses all ten styles. The visible canvases share one
engine/WebGL context. See the live [representation gallery](../../tutorial/representations.md).

## Direct HTML usage

HTML applications can declare the component themselves:

```html
<molvis-viewer
  src="/structures/aspirin.sdf"
  format="sdf"
  representation="spacefill"
  controls="view trajectory"
></molvis-viewer>
```

Listen for `molvis:ready` before reading `element.app`; listen for
`molvis:error` to surface fetch, format, or configuration failures. Removing the
element aborts pending fetches and destroys its app.

Continue with [Lifecycle](lifecycle.md).
