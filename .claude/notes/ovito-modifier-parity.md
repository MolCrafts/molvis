# OVITO ↔ MolVis modifier capability matrix

Passive inventory. Updated when a parity wave ships.  
**Excluded by product decision:** all Python-related OVITO modifiers; all
Voronoi-related features (Voronoi analysis, Voronoi voids, VoroTop).

**Placement iron law**

| Placement | Criterion |
|-----------|-----------|
| Pipeline Add menu | **OVITO categories**: Selection, Modification, Coloring, Structure identification, Visualization, Analysis (no Python folder) |
| Pipeline modifier | Changes frame data and/or canvas |
| Left Analysis panel | Chart-only series (RDF/MSD/…); optional **Add pipeline modifier** when results can paint |
| Left compute / right draw | Structure ID / mesh steps: left = compute; pipeline bottom = draw (`usesLeftConfig`) |
| Settings | Viewport graphics (e.g. SSAO) — not a pipeline step |

**Status legend:** `done` · `partial` · `gap` · `oos` (out of scope / no molrs) · `n/a` (different product model)

---

## Selection

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| Expression selection | `Expression Select` | done | |
| Clear selection | `Clear Selection` | done | Empty mask (not all) |
| Invert selection | `Invert Selection` | done | Needs `selectionScopeId` in full pipeline |
| Expand selection | `Expand Selection` | done | cutoff / bonds / both |
| Select type | `Select Type` | done | element + type columns |
| Manual selection | Select mode → `SelectModifier` | partial | Interactive only; not Add-menu (intentional) |
| Hide selected (via delete/hide) | `Hide Selection` | done | Under Selection |
| Select overlapping particles | `Select overlapping` | done | Fixed cutoff neighbor pairs |
| Select type (particle type UI) | Select Type | done | Frame element/type chips + free text |

## Modification

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| Slice | `Slice` | done | |
| Wrap at periodic boundaries | `Wrap PBC` | done | Molecule-aware |
| Affine transformation | `Affine transformation` | done | Scale + translate; cell optional |
| Delete selected | `Delete Selected` | done | |
| — | `Hide Hydrogens` | n/a | MolVis-only convenience |
| Replicate (periodic images) | `Replicate` | done | Integer images along cell vectors |
| Unwrap trajectories | `Unwrap trajectories` | done | MIC accumulate; scrub-back re-seeds |
| Compute property | `Compute property` | done | Expression → F64 column |
| Edit simulation cell | `Simulation cell` Edit lattice panel | done | lengths / origin / PBC on DrawBox panel |
| Edit types | `Edit types` | done | Selection → element/type |
| Freeze Property | `Freeze property` | done | Snapshot column, reapply later frames |
| Combine datasets | Multi–DataSource compose | done | Product model: Primary + Add source + enable; timeline-aligned frames (length-1 broadcast); see docs/tutorial/pipeline.md |
| Load trajectory | File / DS ingress | n/a | Not a pipeline modifier by design |
| Smooth trajectory | `Smooth trajectory` | done | Sliding-window average of coords |
| Python script | — | oos | Excluded |

## Coloring

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| Assign color | `Assign Color` | done | |
| Color coding | `Color by Property` | done | Continuous / categorical |
| Color by type | `Color by Type` | done | element categorical preset |
| Ambient occlusion | Settings → SSAO2 | done | World.applyGraphicsSettings + GraphicsSection |
| Structure → color | Steinhardt / Solid–liquid | partial | Molrs structure-order, not OVITO PTM/CNA |

## Visualization

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| Create bonds | `Create bonds` | done | |
| (Bonds visual) | `Bonds` | done | Auto-attach + user-addable |
| Simulation cell | `Simulation cell` | done | |
| Create isosurface | `Create isosurface` | done | Grid block; left compute / right draw |
| Particles | `Particles` | done | Auto-attach only |
| — | `Cartoon` | n/a | Auto-attach protein path |
| — | `Vector field` | n/a | MolVis; also displacement draw path |
| — | `Gaussian density surface` | n/a | Closest to Construct surface mesh |
| Construct surface mesh | `Construct surface mesh` | done | Gaussian denser grid → MC; left compute / right draw |
| Coordination polyhedra | `Coordination polyhedra` | done | Neighbor wireframes; overlay |
| Generate trajectory lines | `Generate trajectory lines` | done | Multi-frame polylines; overlay |

## Structure identification

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| (order parameters) | Steinhardt order / Solid–liquid | partial | Pipeline Coloring + left config |
| Ackland–Jones / CNA / PTM / CSP / Chill+ / Diamond | — | oos | No molrs backends |
| VoroTop | — | oos | Voronoi excluded |

## Analysis (OVITO modifiers that are chart/compute)

Iron law: **left Analysis**, not Add-modifier menu (unless scene-changing).

| OVITO | MolVis | Status | Notes |
|-------|--------|--------|-------|
| Radial distribution function | RDF left panel | done | |
| Cluster analysis | `Cluster` modifier + left panel | done | Writes `cluster_N` (slot id); atom+bond color via `__color_*` + split bonds; COM / Rg pick mask column |
| Time series / histogram / scatter | Generic Compute (series/accumulate) | done | First-class picker labels + Run/Cancel + line charts; catalog-driven |
| Find rings | Compute → Rings (SSSR) | done | `topology.rings` panel; select ring atoms; not a pipeline modifier |
| Displacement vectors | `Displacement vectors` + Vector field | done | Writes Displacement.X/Y/Z; draw via Vector field |
| Atomic strain / elastic / DXA / Wigner–Seitz / grain | — | oos / gap | Need molrs; DXA/grain likely oos |
| Bond order / angle / length distributions | Generic Compute (`distribution.*`) | done | Catalog-driven GenericAnalysisPanel (angle / combined); charts only |
| Voronoi analysis | — | oos | Excluded |
| Python-based analyses | — | oos | Excluded |

---

## Implementation priority (for specs)

| Priority | Items | Target slug / wave |
|----------|--------|-------------------|
| P0 | Replicate; Unwrap trajectories | **shipped** |
| P1a | Compute/Freeze/Edit types/Select overlapping/Displacement | **shipped** |
| P1b | Coordination polyhedra; Trajectory lines; Construct surface mesh | **shipped** |
| P2 | Smooth trajectory; SSAO; Edit lattice UX | **shipped** |
| OOS | Python; Voronoi\*; CNA/PTM/CSP/DXA without molrs | never without deliberate note |

\* Voronoi voids / analysis / VoroTop explicitly excluded.

---

## Current Add-menu inventory (registry)

Selection: Expression Select, Clear Selection, Invert Selection, Select Type, Expand Selection, Select overlapping, Hide Selection  

Modification: Slice, Wrap PBC, Affine transformation, Replicate, Unwrap trajectories, Smooth trajectory, Compute property, Freeze property, Edit types, Delete Selected, Hide Hydrogens  

Coloring: Color by Property, Color by Type, Assign Color  

Structure identification: Steinhardt order, Solid-liquid  

Visualization: Create bonds, Bonds, Simulation cell, Vector field, Gaussian density surface, Construct surface mesh, Coordination polyhedra, Generate trajectory lines, Create isosurface  

Analysis: Displacement vectors, Cluster, Center of mass, Radius of gyration  

Auto-attach only: Particles, Cartoon, Transparent  

Modification also: … (no Displacement — that is Analysis)
