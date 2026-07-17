# Browser-backed Python scripts

Outside a notebook, `Molvis()` starts a local page/WebSocket server and opens
the page in the default browser. The command API is the same as in Jupyter; only
the display surface changes.

## Minimal script

```python
import molvis as mv

scene = mv.Molvis(name="analysis")
scene.draw_frame(frame)
scene.set_style(style="spacefill")

try:
    input("Press Enter to close MolVis…")
finally:
    scene.close()
```

The first synchronous drawing command waits for the browser client to complete
its authenticated handshake. Keep the Python process alive while the viewer is
in use.

## Control browser opening

Advanced applications can supply a transport:

```python
transport = mv.WebSocketTransport(
    host="localhost",
    port=8765,
    open_browser=False,
)
scene = mv.Molvis(name="service", transport=transport)
print(scene.connection_url)
```

Use `open_browser=False` when another process or UI is responsible for opening
the page. Tokens are generated automatically unless explicitly configured.

## Named-scene registry

```python
mv.Molvis.list_scenes()
mv.Molvis.get_scene("analysis")
mv.Molvis.session_summary()
```

A duplicate name must use compatible width, height, GUI, and transport options.
Use `Molvis.replace(...)` when a deliberate configuration change should close
and recreate the registered scene.

Continue with [Molecular data](data.md).
