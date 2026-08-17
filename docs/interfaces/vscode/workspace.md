# MolVis Workbench

The Workbench is an editor tab that **hosts both peer engines**:

- **Stage** — 3D (`@molcrafts/molvis-stage`)
- **Sketch** — 2D (`@molcrafts/molvis-sketch`)

Switch with the Stage | Sketch tabs (or commands). Each engine mounts lazily
the first time you open its tab.

It is **not** the full React `page/` shell — use **MolVis: Open Page** for that.

## Open

- **MolVis: Open Workbench** (default Stage tab)
- **MolVis: Open Stage** / **Open Sketch**
- Activity Bar Home actions
- Explorer → Load in Workbench / Open Structure…

## Stage tab

- Load molecular files (stream when large)
- Structure Outline activity-bar tree
- Stage built-in UI (`showUI`)

## Sketch tab

- Package-owned chrome (`SketchComposer`, `gui: true`)
- Export SVG/PNG via host Save dialog

## Related commands

| Command | Role |
|---------|------|
| Quick View (Stage) | Lightweight stage-only surface (not Workbench) |
| Open Page | Full product UI from `page/` |
| Open Sketch (activity bar) | Standalone sketch webview (also available) |

Continue with [configuration](configuration.md).
