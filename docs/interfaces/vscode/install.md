# Install the VS Code extension

MolVis requires VS Code 1.120.0 or newer, matching the extension manifest.

## Marketplace

Open Extensions with Ctrl/Cmd+Shift+X, search for **MolVis**, verify the
publisher is **molcrafts**, and select Install.

You can also open the
[Visual Studio Marketplace listing](https://marketplace.visualstudio.com/items?itemName=molcrafts.molvis).

## Open VSX and VSIX

- VSCodium-compatible hosts can use the
  [Open VSX listing](https://open-vsx.org/extension/molcrafts/molvis).
- For an offline installation, download a `.vsix` from
  [GitHub releases](https://github.com/molcrafts/molvis/releases), then run
  **Extensions: Install from VSIX…**.

## Verify activation

After installation:

1. confirm the MolVis molecule icon appears in the Activity Bar;
2. open the MolVis Home view;
3. run **MolVis: Show Output Channel** from the Command Palette;
4. check that the channel reports activation without an exception.

The Home view remains lightweight and native; it does not allocate a WebGL
canvas until you open Quick View or the Workspace.

Continue with [Quick View](quick-view.md).
