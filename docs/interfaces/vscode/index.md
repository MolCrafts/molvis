# VS Code

The MolVis extension integrates molecular files with VS Code's editor,
workspace, remote-file, command, and settings APIs. It is not a separate
renderer: its webviews host the same stage engine as the web product, with a
VS Code–specific host protocol for files and settings.

## Choose a surface

| Surface | Use it when |
|---|---|
| Quick View (Stage) | One file is the document of record; light 3D peek |
| Quick View (Sketch) | Light 2D peek (`.mol` / `.sdf` and Command Palette) |
| Workbench | Session with **Stage + Sketch** tabs, outline, multi-load |
| Open Stage / Open Sketch | Jump into Workbench on that engine |
| Open Page | Full React product shell |
| Activity Bar Home | Recent files and workflow entry (native tree) |
| Activity Bar Sketch | Standalone 2D sketch webview |

## Read this section

1. [Install and verify the extension](install.md)
2. [Open files with Quick View](quick-view.md)
3. [Use the MolVis Workbench](workspace.md)
4. [Configure core and runtime settings](configuration.md)
5. [Work locally, over SSH, WSL, and containers](remote.md)
6. [Troubleshoot webviews and file loading](troubleshooting.md)
