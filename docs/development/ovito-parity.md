# OVITO modifier parity

MolVis’s Add-modifier menu follows OVITO’s folder layout (Selection /
Modification / Coloring / Structure identification / Visualization / Analysis).
Not every OVITO modifier exists here. Chart-only analyses and some viewport
graphics live outside the pipeline (only steps that change the canvas are
modifiers).

## Placement

| Where | What |
|-------|------|
| Pipeline Add menu | Selection, Modification, Coloring, Structure identification, Visualization, Analysis |
| Left Analysis panel | Chart-only RDF / MSD / histograms; optional “Add pipeline modifier” when results can paint the scene |
| Left compute / right draw | Structure ID and mesh steps that set `usesLeftConfig` |
| Settings | Viewport graphics (for example ambient occlusion) |

There is no separate Python-only modifier folder in the UI.

## Shipped pipeline modifiers

| Folder | Modifiers |
|--------|-----------|
| Selection | Expression Select, Clear, Invert, Select Type, Expand, Select overlapping, Hide Selection |
| Modification | Slice, Wrap PBC, Affine, Replicate, Unwrap, Smooth trajectory, Compute property, Freeze property, Edit types, Delete Selected, Hide Hydrogens, Edit lattice (multi-file = multiple DataSources, not Combine modifier) |
| Coloring | Color by Property, Color by Type, Assign Color |
| Structure identification | Steinhardt order, Solid–liquid |
| Visualization | Create bonds, Bonds, Simulation cell, Create isosurface, Vector field, Gaussian density / Construct surface mesh, Coordination polyhedra, Generate trajectory lines |
| Analysis | Displacement vectors |

## Outside the pipeline

| Surface | Examples |
|---------|----------|
| Left Analysis | RDF, MSD, histograms, cluster (with optional “add Color by Property”) |
| Settings | SSAO / ambient occlusion and other viewport graphics |

## Not in MolVis

Python OVITO scripting, Voronoi analysis, and CNA / PTM / CSP / DXA without
molrs support remain out of scope.
