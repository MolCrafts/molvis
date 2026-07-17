# Remote, WSL, and container workspaces

MolVis separates the extension host from the webview renderer. In SSH, WSL, and
Dev Container sessions the extension host reads remote files while the local VS
Code window renders the WebGL canvas.

## File flow

1. You choose a resource through Explorer or **Open Structure…**.
2. The remote extension host reads it through VS Code's file-system API.
3. The host transfers text/binary payloads to the webview.
4. MolVis parses and renders locally in the webview.

This is why Explorer drag-and-drop works without exposing a remote filesystem
path directly to browser JavaScript.

## Save flow

Save reverses the route: the webview exports the current frame, the extension
serializes/receives the payload, and VS Code's provider writes it remotely.
Normal workspace permissions still apply.

## Performance considerations

- File transfer time depends on the remote connection.
- Rendering uses the GPU available to the local VS Code window.
- Very large binary trajectories may be better converted to a chunked/random
  access source near the remote workspace.
- Avoid opening many independent Quick Views because every interactive viewer
  owns a WebGL context.

Use the MolVis Output channel to distinguish remote read failures from local
webview/GPU failures.

Continue with [Troubleshooting](troubleshooting.md).
