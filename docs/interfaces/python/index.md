# Python and Jupyter

The Python binding controls the same browser frontend over a local,
token-authenticated WebSocket. One `molvis.Molvis` class adapts its display to
the host:

- a normal Python process opens a browser tab;
- JupyterLab, classic Jupyter, Colab, and VS Code notebooks mount inline output;
- a headless process can host the command channel without opening a display.

## Read this section

1. [Install and choose extras](install.md)
2. [Display and update notebook scenes](notebooks.md)
3. [Run browser-backed Python scripts](scripts.md)
4. [Send frames, trajectories, and styles](data.md)
5. [Receive events and inspect cached state](events.md)
6. [Encode snapshots as video](video.md)

The guide focuses on lifecycle and workflow. Exact methods and transport types
are collected in the [Python API reference](../../api/python.md).
