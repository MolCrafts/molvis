# VSCode extension

The MolVis VSCode extension turns any chemistry file in your workspace
into an interactive 3D viewer. No configuration is required; installing
it is enough.

## Install

- **Marketplace** — search "MolVis" in the Extensions view
  (**Ctrl/Cmd+Shift+X**) and click *Install*. Or visit
  [the Marketplace page](https://marketplace.visualstudio.com/items?itemName=molcrafts.molvis).
- **Open VSX** — available at
  [open-vsx.org/extension/molcrafts/molvis](https://open-vsx.org/extension/molcrafts/molvis)
  for VSCodium and Cursor users.
- **VSIX** — download `molvis-<version>.vsix` from the
  [releases page](https://github.com/molcrafts/molvis/releases) and
  run **Extensions: Install from VSIX…** from the command palette.

The extension requires VSCode 1.108.1 or newer.

## Activity Bar (Home)

Click the **MolVis** mole icon in the Activity Bar. The Home view is a
lightweight native tree (no WebGL in the sidebar):

| Section | What it does |
|---------|----------------|
| **Open Workspace** | Full MolVis UI in an editor tab (sidebars, pipeline, analysis). |
| **Open Structure…** | Pick a structure/trajectory file or Zarr folder → Workspace. |
| **Peek Active File** | Side-by-side Quick View of the current editor file. |
| **Recent** | Re-open files you already viewed (click = Quick View; context menu for Workspace). |
| **Help** | Docs and the MolVis Output channel. |

Title-bar icons on the Home view also expose Open Structure and Open Workspace.

## Open a file

### As the editor

Right-click a `.pdb`, `.xyz`, `.data`, `.dump`, or `.lammpstrj` file in
the Explorer and choose **Open With… → MolVis Quick View** (text formats)
or open a binary trajectory (`.dcd` / `.trr` / `.xtc`) which uses MolVis
by default.

![A PDB file open in the MolVis custom editor](../assets/vscode-editor.png)

To make MolVis the default editor for a format, pick **Configure
default editor for `*.pdb`** in the same menu.

The custom editor keeps the file as the document of record;
**Ctrl/Cmd+S** writes the current pipeline output back to disk, and the
editor tab shows a marker when there are unsaved changes.

### Side-by-side (Quick View)

If you want to keep the raw text and the viewer visible at the same
time, right-click the file and choose **MolVis: Quick View**. This
opens the viewer in a second editor column while leaving the text
editor in the first.

![Quick View: MolVis on the right, text editor on the left](../assets/vscode-quickview.png)

### Full workspace

**MolVis: Open Workspace** (Activity Bar or command palette) opens the
full page UI in an editor tab. Use **Open Structure…** to pick a file,
or drag files from the Explorer onto the viewport — drag works across
SSH remote sessions because the extension host reads the bytes and
forwards them to the viewer.

## The viewport

The viewport inside VSCode is the same React application as the
[web viewer](web.md). Modes, pipeline, selection, measurement,
screenshot export — everything behaves identically. Read the web
viewer guide for feature details.

A few interactions are VSCode-specific:

- **Save** (**Ctrl/Cmd+S**) — serializes the current pipeline output to
  the file format implied by the document's extension and writes it
  through VSCode's file system provider. Works over SSH remote and
  WSL. For read-only formats (Zarr directories), Save is disabled.
- **Reload** (`MolVis: Reload` command) — reloads the viewer without
  reopening the file. Use this after editing the file in another tool.
- **Drag & drop from the Explorer** — replaces the current document
  with the dropped file. Works on SSH remote.

## Configuration

The extension reads two blocks from your workspace or user settings:

### `molvis.config`

Applied when the viewer starts.

```jsonc
{
  "molvis.config": {
    "showUI": true,
    "useRightHandedSystem": true,
    "canvas": { "antialias": true, "alpha": false }
  }
}
```

### `molvis.settings`

Applied after the viewer starts.

```jsonc
{
  "molvis.settings": {
    "cameraZoomSpeed": 1.5,
    "grid": { "enabled": true, "size": 100, "opacity": 0.3 },
    "graphics": { "fxaa": true, "hardwareScaling": 1.0 }
  }
}
```

Changes to either block take effect the next time you run
**MolVis: Reload** or reopen the file. The full schema is validated
by VSCode and autocompletes in `settings.json`.

## Troubleshooting

**"Cannot display file: WebGL is not supported."**  
VSCode's webview needs GPU compositing. On Linux, enable hardware
acceleration in `settings.json`
(`"disable-hardware-acceleration": false`) or launch VSCode with
`--enable-gpu-rasterization`.

**The viewer is blank after opening a very large file.**  
Check the **Output** channel → *MolVis*. Files over ~200 MB may
exceed the VSCode webview message limit; open the file in the
[web viewer](web.md) for those cases, or convert it to Zarr first.

**Why doesn't my notebook see the selection I made in VSCode?**  
The extension and the Jupyter widget do not share state. Running
both is fine, but selections made in one are not mirrored to the
other.
