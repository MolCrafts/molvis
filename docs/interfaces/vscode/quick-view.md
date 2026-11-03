# Quick look

Quick look treats a molecular file as the VS Code document. It is the right
surface for inspecting or editing one workspace resource while preserving
normal editor tabs, dirty state, and Save behavior.

## Open as a custom editor

Right-click a supported file in Explorer and choose **Open With… → Quick
look**. Text structures include PDB, XYZ, CIF, LAMMPS data/dump, SDF/MOL, Cube,
CHGCAR, GRO, MOL2, and POSCAR variants. DCD, TRR, and XTC open as Quick look
panels (no editor-picker bar).

Choose **Configure default editor for…** if a format should normally open in
MolVis instead of the text editor.

## Open beside text

Run **Quick look** from the Explorer context menu, the editor title button, or
Command Palette. The extension opens a **3D** viewer column while leaving the
source text visible. Use this when you want to edit text and reload the
molecular result without changing the default editor association.

Quick look is not a separate viewer — it is the full shell with its interface
hidden. **Show controls** on the canvas, or **Open in Page** in the tab title,
reveals the interface in the same tab: the scene, the camera and the parsed
frame all stay as they are, and the file is never read twice.

## Sketch Quick look (2D)

Right-click a `.mol` / `.sdf` file → **Quick look (Sketch)** for a
lightweight **2D** peek. For a longer 2D session, use **MolVis: Open Sketch**.

| Surface | Engine | Use when |
|---|---|---|
| Quick look (Stage) | 3D canvas, interface hidden | Inspect coordinates / trajectory / cell |
| Quick look (Sketch) | 2D sketch | Peek or edit a connection table |
| Stage | 3D editor tab | Longer 3D session |
| Sketch | 2D editor tab | Longer 2D session |

Sketch Quick look loads V2000 MOL/SDF connection tables when possible; other
formats open an empty sketch board without failing the host handshake. For
a longer 2D session, use **Open Sketch**.

## Save semantics

Ctrl/Cmd+S invokes `MolVis: Save` while a MolVis editor is active. The extension
requests the current pipeline/staged frame, serializes it using the document
extension, and writes through VS Code's file-system provider.

Important boundaries:

- Save writes molecular data, not camera or representation state.
- Read-only or directory formats such as Zarr cannot be overwritten as a normal
  text document.
- The tab dirty indicator represents unsaved staged/pipeline changes.

Use **MolVis: Reload View** after an external program changes the source file.

Continue with [Stage and Sketch](workspace.md).
