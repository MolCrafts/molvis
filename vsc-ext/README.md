# MolVis — Molecular Visualization for VSCode

Interactive 3D molecular viewer directly inside VSCode. Open PDB, XYZ, or LAMMPS files and explore structures with GPU-accelerated rendering.

## Features

- Open `.pdb`, `.xyz`, `.data` files as interactive 3D views
- Multi-frame trajectory playback for XYZ files
- Zarr directory support for large simulation trajectories
- Three representations: Ball & Stick, Spacefill, Stick
- Simulation box wireframe with color/thickness controls
- Modifier pipeline: hide hydrogens, color by property, slice, expression selection
- Drag-and-drop file loading onto any MolVis canvas

## Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| PDB | `.pdb` | Protein Data Bank, CRYST1 box support |
| XYZ | `.xyz` | ExtXYZ, multi-frame trajectory |
| LAMMPS data | `.data` | LAMMPS data format |
| LAMMPS dump | `.dump`, `.lammpstrj` | LAMMPS trajectory dump |
| Zarr | `.zarr` | Directory-based binary trajectory |

## Getting Started

1. Install the extension from the VS Marketplace
2. Open any `.pdb`, `.xyz`, or `.data` file
3. Right-click the editor tab → **Reopen Editor With...** → **MolVis Quick Preview**

Or use the command palette: `MolVis: Quick Preview` for a fast side-by-side look.

## Commands

MolVis offers two viewing experiences for a molecular file:

| Command | Description |
|---------|-------------|
| `MolVis: Quick Preview` | Lightweight, fast-loading 3D preview (read-only look). Also what **Reopen Editor With… → MolVis Quick Preview** opens. |
| `MolVis: Open in Editor` | Full MolVis editor — sidebar, edit mode, structure builder. |
| `MolVis: Reload View` | Reload the active MolVis view. |
| `MolVis: Save` | Save edits from a MolVis editor (`Ctrl/Cmd+S`). |

## Configuration

### `molvis.config`

```jsonc
{
  "molvis.config": {
    "useRightHandedSystem": true,
    "canvas": { "antialias": true }
  }
}
```

### `molvis.settings`

```jsonc
{
  "molvis.settings": {
    "grid": { "enabled": true, "size": 100, "opacity": 0.3 },
    "graphics": { "fxaa": true, "hardwareScaling": 1.0 }
  }
}
```

## Development

```bash
# From monorepo root
npm install
npm run build:all

# Launch extension dev host
# Open vsc-ext/ in VSCode, press F5

# Tests
npm run test:vsc-ext
```

### Publish

Automated via GitHub Actions on tag push:

```bash
git tag v0.0.2
git push origin v0.0.2
```

Requires `VSCE_PAT` and `OVSX_PAT` secrets configured in the GitHub repo.

Manual publish:

```bash
cd vsc-ext
npx vsce publish --no-dependencies
npx ovsx publish --no-dependencies
```

## Requirements

- VSCode 1.108.1+

## License

BSD-3-Clause
