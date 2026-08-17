# MolVis — Molecular Visualization for VSCode

Interactive molecular visualization inside VS Code: **stage** (3D) and **sketch**
(2D) as peer engines, optional full **page** product shell, plus stage **Quick View**.

## Surfaces

| Surface | Command | What |
|---------|---------|------|
| **Quick View** | `MolVis: Quick View (Stage)` | Light stage-only peek (custom editor / side-by-side) |
| **Workbench** | `MolVis: Open Workbench` | Editor tab hosting **Stage + Sketch** tabs (lazy mount) |
| **Stage** | `MolVis: Open Stage` | Workbench focused on 3D |
| **Sketch** | `MolVis: Open Sketch` | Workbench focused on 2D |
| **Page** | `MolVis: Open Page` | Full React product shell (`page/`) |
| **Home** | Activity Bar | Native tree (actions / recent / help) |
| **Sketch side bar** | Activity Bar Sketch | Standalone sketch webview (peer entry) |

## Architecture

```
vsc-ext host (Node): files, commands, outline, postMessage
  ├─ Quick View webview     → stage only
  ├─ Workbench webview      → stage ⟷ sketch (tabs, lazy L1)
  ├─ Page webview           → page package (optional)
  └─ Sketch activity webview → sketch only
```

- **stage** and **sketch** are package peers; Workbench serves both.
- **page** is an optional third product path, not a parent of the engines.
- Host never reverse-depends on page for Workbench/QV/Sketch-side defaults.
- Protocol: `vsc-ext/src/protocol/`; stage bridge: `attachStageHost`.

## Commands (palette)

- `MolVis: Quick View (Stage)`
- `MolVis: Open Workbench` / `Open Stage` / `Open Sketch` / `Open Page`
- `MolVis: Open Structure…` / `Load in Workbench`
- `MolVis: Reload View` / `Save`

## Configuration

`molvis.config` / `molvis.settings` → stage via `init` / `applySettings`.  
`molvis.plugins` is reserved (not wired on engine-only surfaces).

## Development

```bash
# monorepo root
npm install
npm run build:all

# F5 with vsc-ext/ folder open
npm run test:vsc-ext
```

## License

BSD-3-Clause
