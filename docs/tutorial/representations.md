# Molecular representations

A **representation** is the global rule that converts the current frame into
visible atom and bond geometry. It controls visibility, radius source,
bond order and labels. Materials, coloring, lighting and effects are independent. It does not change molecular
coordinates or chemical identity.

## Compare complete visual presets

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

Outlines are configured independently in Settings → Lighting & effects. Their
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


## Configure one layer at a time

```python
stage.set_style("ball-and-stick")       # legacy complete-look entry
stage.set_material("atom", "glossy")
stage.set_material("bond", "matte")
stage.set_representation("spacefill")   # geometry changes; materials stay
```

Settings → Style separates geometry, complete visual presets, color theme and
background. Settings → Material controls atoms and bonds independently.
Settings → Lighting & effects controls scene illumination, outlines, ambient
occlusion and depth of field. Settings → Graphics contains anti-aliasing and
render scale.

The current glossy model adds a white Blinn–Phong highlight. It does not
simulate metallic environment reflection or glass refraction. `metal-tube`
selects a metal-aware geometry policy, not a metallic material. New material
choices use the current rendering path.

For declarative PNG renders, `materials` is accepted globally and per panel:

```json
{
  "style": "ball-and-stick",
  "materials": {"atom": {"preset": "glossy", "specularPower": 48}},
  "panels": [{"structure": "aspirin.sdf", "output": "aspirin.png"}]
}
```

Each panel starts from default surface coefficients before applying its style
and material overrides, so a previous panel's material cannot leak into it.

## Checkpoint

Switching from ball-and-stick to spacefill changes the visible radius contract;
it does not edit the frame. Next, learn how [selection](selection.md) records
which atoms or bonds you intend to act on.
