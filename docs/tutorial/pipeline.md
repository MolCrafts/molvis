# The modifier pipeline

The **pipeline** is an ordered transformation from loaded source data to the
frame that MolVis renders. It makes data operations visible, reorderable, and
undoable instead of hiding them in one-off UI actions.

## Read a pipeline from top to bottom

Consider this sequence:

```text
DataSource → Slice → ExpressionSelect → ColorByProperty → rendered frame
```

Each modifier receives the previous modifier's output. Reordering therefore
changes meaning. Selecting atoms before slicing can preserve a named selection
that includes atoms later removed from view; slicing first limits what the
expression can see.

## Source versus derived frame

The DataSource modifier owns the original structure or trajectory. Later
modifiers operate on working frames. This gives MolVis two useful guarantees:

- disabling or deleting a modifier can recover upstream data;
- exporting the rendered result does not require overwriting the original file.

The scene is rebuilt from the active pipeline output. Representation remains a
global visual setting outside the molecular data path, so changing from
wireframe to spacefill does not insert a modifier.

## Multiple data sources

MolVis models multi-file scenes as **several DataSources** composed at the head
of the pipeline (not an OVITO-style “Combine datasets” modifier).

| Concept | Meaning |
|---|---|
| **Primary** | First enabled DataSource. **Replace primary…** overwrites it (and its trajectory). Open / reset starts with an **empty pipeline** — no ghost Empty Scene row. |
| **Add source…** | Augment: extra sources compose into one working frame. |
| **Enable** | Checkbox mutes a source without deleting it. |
| **Frame index** | Length-1 sources **broadcast** on every scrub. Multi-frame sources must share the same length as the timeline max; unequal multi-frame lengths error (not silent clamp). |

**Compose merge (augment):** same-name blocks must share row counts and
structural shapes. Columns union with later sources winning duplicate keys.
When a length-1 topology is paired with a trajectory, atom IDs align the rows:
coordinates, velocities and forces come from the trajectory, while shared
identity/topology fields come from the topology. Columns unique to either
source are retained. The first time-varying source's box takes precedence over
broadcast boxes; otherwise the first available box wins.

Frame metadata is retained. Time-varying metadata overrides broadcast metadata;
within either group, the later source wins. **Extend** concatenates atoms and
bonds, adds atom `source_id`, and rebases bond endpoints. It retains metadata
from all sources, with the first source winning conflicts (also used for the
box). Extend is a separate loader path from scrub-time composition.

Column copies preserve primitive storage widths, bool/string values and per-row
shapes. Missing extension-column rows default to zero, false or an empty string;
missing coordinates and incompatible column shapes are errors. A transformation
that cannot retain complex values, nullable data or precision/target attributes
fails explicitly. Whole-block projection uses MolRS's native copy and preserves
those attributes.

Removing the last DataSource leaves the pipeline empty. Compose with zero
sources is an empty Frame. Sketch or optimize commit creates a memory
primary when none exists.

## Common modifier categories

Add-menu groups are one-word nouns (Source / Selection / Modification /
Color / Structure / Visualization / Analysis). Search the catalog to
reach an item — Wrap PBC is a pipeline flag under Modification, not a
step you add.

| Group | Examples | Effect |
|---|---|---|
| Selection | Expression select, Clear / Invert / Select type / Expand / Select overlapping, Hide selection | Create or act on a selection set |
| Modification | Slice, Wrap PBC, Affine, Replicate, Unwrap, Smooth trajectory, Compute/Freeze property, Edit types, Delete selected, Hide hydrogens | Edit topology or coordinates |
| Color | Color by property, Color by type, Assign color | Per-atom color |
| Structure | Steinhardt order, Solid–liquid | Local structure → atom columns (molrs) |
| Visualization | Create bonds, Bonds, Simulation cell, Isosurface, Volume cloud, Vector field, Molecular surface, Coordination polyhedra, Generate trajectory lines | Scene visuals |
| Analysis | Displacement vectors | Pipeline property compute that feeds viz |

Chart-only analyses (RDF, MSD, histograms, Rings, bond distributions, …) stay
in the **left Compute** panel — same iron law as before; they are not Add-menu
items.

**Coordinates:** Simulation cell → Wrap sets a post-compose policy (as
deposited / wrap atoms / wrap molecules / unwrap trajectory). Draws consume the
post-policy frame; CHGCAR/CUBE grids are not rewritten by this policy.

**Iron law:** only steps that change the canvas belong in the pipeline. Charts
and pure numerical analyses (RDF, MSD, spectra, Rings, …) live in the **left
Compute** panel, driven by the molrs compute catalog plus product entries.

**Left compute / right draw:** analysis-nature pipeline modifiers (Steinhardt,
solid–liquid, molecular surface, vector field, isosurface, …) open the **left**
panel for algorithm parameters when added or selected. The pipeline bottom pane
shows **drawing** parameters only (colors, isovalue, opacity, scale). Pure
Analysis tools that can also paint the scene (e.g. Cluster) expose a button to
**add a right-side** Color by Property (or similar) modifier.

Full OVITO ↔ MolVis gap table (and backlog):
[OVITO parity](../development/ovito-parity.md).

Visual elements such as **Particles** and **Cartoon** auto-attach when a file
loads.

Use the eye control to mute a modifier without deleting its configuration.
Drag to reorder. Use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z to undo and redo command
history.

## A prediction exercise

Imagine selecting `element O`, assigning those atoms red, then hiding the same
selection. The color modifier still runs, but its result is invisible because a
later modifier removes the target atoms. Moving Hide selection above Assign
color means the color modifier receives no selected oxygen atoms.

## Checkpoint

Given two modifiers, you should be able to ask which one receives the other's
output. Next, add time by learning how a [trajectory](trajectory.md) supplies a
different source frame at each index while reusing one pipeline definition.
