# MolVis Workspace

The Workspace is a full MolVis application in an editor panel. It is independent
of a single custom-editor document and is intended for exploration, analysis,
and repeated loading.

## Open it

Use one of these routes:

- select **Open Workspace** in the MolVis Activity Bar Home;
- run **MolVis: Open Workspace** from the Command Palette;
- right-click a recent item and choose **Open in Workspace**.

## Load structures

Select **Open Structure…** to use VS Code's file picker, or drag a supported
Explorer resource into the viewport. The extension host reads the resource and
forwards bytes to the webview, so loading also works when the file is remote.

## Understand ownership

Unlike Quick View, Workspace is not automatically backed by one editable VS
Code document. Loading a second structure can replace or augment the current
scene according to the chosen load mode. Export asks for an output destination
instead of silently overwriting the first input.

## Use the complete UI

The Workspace exposes:

- View, Select, Edit, Manipulate, and Measure modes;
- the ordered modifier pipeline;
- trajectory playback and frame labels;
- analysis panels and data inspection;
- screenshot and molecular-data export;
- backend connection controls for Python-driven sessions.

The conceptual behavior is covered in the [Tutorial](../../tutorial/index.md).
Continue with [Configuration](configuration.md) for host-specific defaults.
