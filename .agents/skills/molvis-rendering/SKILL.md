---
name: molvis-rendering
description: Implement MolVis 3D rendering, visual presets, atom and bond materials, selection, picking, and canvas edits. Use when changing Artist, shaders, render settings, draw modifiers, SceneIndex, or scene rebuild behavior.
---

# MolVis rendering

## Keep visual responsibilities separate

| Concern | Canonical owner |
|---|---|
| Molecular geometry and radii | `stage/src/artist/representation.ts` |
| Atom/bond surface response | `stage/src/artist/material.ts` |
| Element palette and data colors | Theme/color state in `StyleManager` and color modifiers |
| Lighting, effects, device quality | Separate settings in `stage/src/settings.ts` |
| Complete coordinated look | `stage/src/artist/visual_preset.ts` |
| Render implementation and snapshots | Artist/shaders and `MolvisRenderer` |

- Materials (`matte`, `glossy`, `illustrative`, `unlit`) describe shading and
  specular response, independent of geometry, data colors, lighting, and backend.
  Adding a material does not require another renderer.
- `Representation` controls geometry. `flat` is a complete visual preset,
  not a geometry ID; `metal-tube` controls element visibility.
- Atom and bond materials are independent. Surfaces and ribbons own their
  style contracts; do not silently apply atom/bond settings to them.
- Reuse `StyleManager`, the material/representation catalogs, and engine
  commands. Material-only edits update uniforms without rebuilding buffers.
- A visual preset applies geometry, atom/bond materials, outline settings, and
  bond-color routing as one undoable operation. It preserves palette, data
  colors, background, lighting, and device quality.
- `MolvisRenderer` remains the snapshot facade. New scene operations belong on
  the app/commands rather than in a parallel renderer API.

Current public behavior is documented in
[Molecular representations](../../../docs/tutorial/representations.md).

## Update versus rebuild

`classifyFrameTransition` in `stage/src/system/frame_diff.ts` decides the
pipeline pass's `changeKind`.

- `position`: update existing buffers only. Do not register Frames again or
  recreate `ImpostorState`.
- `full`: reset topology once in `MolvisApp.applyPipeline`, before Draw steps,
  then rebuild. Individual layer registration never resets topology; Bonds
  may register before Particles.
- Carry this verdict through `PipelineContext` and `frame-rendered`. Consumers
  must not infer topology changes from row counts: equal-count swaps exist.

For canvas interaction, export, edit overlays, and selection remapping, read
[SceneIndex contracts](references/canvas-sceneindex.md). For coordinate and
WASM lifetime changes, also read [molvis-data-flow](../molvis-data-flow/SKILL.md).
