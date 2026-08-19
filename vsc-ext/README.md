# MolVis

**A visual workspace where people and agents inspect molecular data together.**

MolVis for VS Code is the same product surface as the web and Jupyter hosts:
molecules, simulation boxes, and trajectories on a 3D **stage**, a 2D
**sketch** editor, and a bidirectional RPC layer so an agent can operate the
live scene while you review the result.

Documentation: [docs.molcrafts.org/molvis](https://docs.molcrafts.org/molvis/)
· [VS Code guide](https://docs.molcrafts.org/molvis/interfaces/vscode/)

## Install

Search **MolVis** in the Extensions view (publisher **molcrafts**) or open
the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=molcrafts.molvis).
Requires VS Code 1.120.0 or newer.

## Use

1. Click the **MolVis** icon in the Activity Bar. Home lists Open Structure,
   Workbench, recent files, and help — it does not start a WebGL canvas.
2. Open a structure file, or right-click one in Explorer → **MolVis: Quick View**.
3. Use **MolVis Sketch** in the Activity Bar for the standalone 2D editor.

| Surface | Command | Use it when |
|---------|---------|-------------|
| **Quick View (Stage)** | `MolVis: Quick View (Stage)` | One file is the document; light 3D peek or custom editor |
| **Quick View (Sketch)** | `MolVis: Quick View (Sketch)` | Light 2D peek (`.mol` / `.sdf`, or Command Palette) |
| **Workbench** | `MolVis: Open Workbench` | A session with Stage + Sketch tabs |
| **Stage / Sketch** | `MolVis: Open Stage` / `Open Sketch` | Jump into Workbench on that engine |
| **Page** | `MolVis: Open Page` | Full React product shell |
| **Home** | Activity Bar | Recent files and workflow entry |
| **Sketch side bar** | Activity Bar Sketch | Standalone 2D editor |

Same engines as the web product. Quick View keeps VS Code document semantics
(dirty state, Save). Workbench is the longer session. Page is the full shell.

## Formats

Text structures open as Quick View (optional editor): PDB, XYZ/ExtXYZ, CIF/mmCIF,
LAMMPS data and dump, SDF/MOL, Cube, CHGCAR, GRO, MOL2, POSCAR/CONTCAR.

Binary trajectories (DCD, TRR, XTC) open as the trajectory viewer. Zarr
directories load through **MolVis: Open Structure…**.

## Commands

- `MolVis: Quick View (Stage)` / `Quick View (Sketch)`
- `MolVis: Open Workbench` / `Open Stage` / `Open Sketch` / `Open Page`
- `MolVis: Open Structure…` / `Load in Workbench`
- `MolVis: Reload View` / `Save`

Settings: `molvis.config` (mount) and `molvis.settings` (runtime). See
[configuration](https://docs.molcrafts.org/molvis/interfaces/vscode/configuration/).

## License

BSD-3-Clause
