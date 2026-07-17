# Quick View

Quick View treats a molecular file as the VS Code document. It is the right
surface for inspecting or editing one workspace resource while preserving
normal editor tabs, dirty state, and Save behavior.

## Open as a custom editor

Right-click a supported file in Explorer and choose **Open With… → MolVis Quick
View**. Text structures include PDB, XYZ, CIF, LAMMPS data/dump, SDF/MOL, Cube,
CHGCAR, GRO, MOL2, and POSCAR variants. DCD, TRR, and XTC use the binary
trajectory editor.

Choose **Configure default editor for…** if a format should normally open in
MolVis instead of the text editor.

## Open beside text

Run **MolVis: Quick View** from the Explorer context menu or Command Palette.
The extension opens a viewer column while leaving the source text visible. Use
this when you want to edit text and reload the molecular result without changing
the default editor association.

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

Continue with the [MolVis Workspace](workspace.md).
