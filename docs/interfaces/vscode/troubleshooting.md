# VS Code troubleshooting

## The editor is blank

Open **MolVis: Show Output Channel** and VS Code's **Developer: Toggle Developer
Tools**. A blank canvas is usually one of three classes:

- WebGL/GPU initialization failed;
- a webview script or WASM asset failed to load;
- the file loader rejected the selected format/content.

On Linux, verify hardware acceleration is enabled and restart VS Code after
changing GPU flags.

## The file opens as text

Use **Open With… → MolVis Quick View**. If the format should always use MolVis,
choose **Configure default editor for…**. Text formats intentionally have
`option` priority so installing MolVis does not unexpectedly replace the user's
editor choice; binary DCD/TRR/XTC use MolVis by default.

## Save is disabled or fails

Confirm that:

- the active tab is a MolVis custom editor or Quick View;
- the source format has a writer;
- the workspace provider is writable;
- the resource is a file rather than a Zarr directory;
- the Output channel does not report a serialization error.

## A large file never appears

Check transfer and memory messages in the Output channel. Large remote files
must first cross the extension-host/webview boundary. Prefer a binary or
chunked trajectory format for long simulations instead of a huge expanded text
dump.

## Notebook selection is different

The VS Code extension and a Python/Jupyter `Molvis` scene are separate sessions
unless explicitly connected through the backend workflow. A selection in one
is not automatically mirrored into the other.
