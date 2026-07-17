# Molecular representations

A **representation** is the global rule that converts the current frame into
visible atom and bond geometry. It controls visibility, radius source, shading,
bond order, labels, and optional outlines. It does not change molecular
coordinates or chemical identity.

## Compare every representation

Every card below displays the same aspirin SDF frame. The ten visible canvases
share one BabylonJS engine and one WebGL context; each card has an independent
MolVis scene and camera registered as an Engine View. Pointer interaction,
toolbars, selection, dragging, zooming, and context menus are disabled. The
molecules rotate slowly, and offscreen cards stop rendering.

```molvis-gallery {src="../assets/aspirin.sdf" format="sdf" rotation-speed="0.08"}
```

The source is the 3-D conformer for
[aspirin, PubChem CID 2244](https://pubchem.ncbi.nlm.nih.gov/compound/2244).

## What each preset emphasizes

| ID | Atom treatment | Bond treatment | Best used for |
|---|---|---|---|
| `ball-and-stick` | Lit element-sized spheres | Split-color, multiple bond order | General molecular inspection |
| `flat` | Flat-shaded outlined spheres | Flat, split-color | Diagram-like teaching figures |
| `ball-and-tube` | Illustrative spheres | Thick closed single tubes | Soft graphic depth cues |
| `tube` | Only endpoint joints | Continuous tubes | Backbone/connectivity emphasis |
| `metal-tube` | Metal-aware joints | Continuous tubes | Coordination environments |
| `wireframe` | Minimal joints | Very thin tubes | Dense structural overview |
| `bubble` | Large illustrative spheres | Hidden | Atom-centered volume comparison |
| `spacefill` | Van der Waals spheres | Hidden | Steric shape and molecular surface |
| `skeletal` | Carbon atoms suppressed | Multiple bonds and heteroatom labels | Organic line-angle reading |
| `graph` | Uniform nodes | Uniform single links | Topology independent of element size |

The heavy outline is configurable for `flat`, `skeletal`, and `graph`. Its
geometry expands outside the original silhouette and adapts its ink color to
the canvas background.

## Author the gallery without HTML

The page source contains only this formatter fence:

````markdown
```molvis-gallery {src="../assets/aspirin.sdf" format="sdf" rotation-speed="0.08"}
```
````

Omit `representations` to use the complete catalog. A focused comparison can
request a subset, for example
`representations="flat skeletal graph"`. Use `rotation-speed="0"` for still
figures.

## Checkpoint

Switching from ball-and-stick to spacefill changes the visible radius contract;
it does not edit the frame. Next, learn how [selection](selection.md) records
which atoms or bonds you intend to act on.
