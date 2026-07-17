# molvis

Python package for MolVis molecular visualization. A single
`mv.Molvis()` class works from both plain Python scripts (opens a
browser tab) and Jupyter notebooks (mounts the page bundle inline in
the cell, isolated by Shadow DOM — no iframe). Both hosts drive the
same page bundle over a local WebSocket.

## Installation

```bash
pip install molvis
```

## Quick start

### Plain Python script

```python
import molvis as mv
import molpy as mp

viewer = mv.Molvis()          # starts a local WebSocket + opens a browser tab
viewer.draw_frame(frame)
viewer.snapshot()             # PNG screenshot
```

### Jupyter notebook

```python
import molvis as mv
scene = mv.Molvis(name="protein")
scene.draw_frame(frame)
scene                          # mounts the viewer inline in the cell
```

Both modes use the same command API (`draw_frame`, `set_style`,
`snapshot`, selection, palettes, …) and the same event channel.

## Bidirectional events

Frontend interactions (selection, mode, frame navigation, …) flow back
into Python. Selection is a shared state — canvas clicks are observable
from Python without polling.

```python
viewer = mv.Molvis()

# Subscribe to a frontend event (callback runs on the WS thread)
handle = viewer.on("selection_changed",
                   lambda ev: print("sel:", ev["atom_ids"]))
handle.remove()                            # unsubscribe

# Block until a specific event fires
ev = viewer.wait_for("selection_changed", timeout=30)

# Cached state, updated live by incoming events — no RPC roundtrip
print(viewer.selection)     # Selection(atom_ids=(...), bond_ids=(...))
print(viewer.current_mode)  # "view" | "select" | "edit" | ...
print(viewer.current_frame)

# Force a fresh snapshot from the canvas
viewer.refresh_state()
```

## Transport

`mv.Molvis()` auto-creates a `WebSocketTransport`. Outside Jupyter it
opens the page in the default browser; inside Jupyter the cell mounts
the bundle inline. For advanced setups (CDN-hosted page, explicit port,
CORS …) pass your own transport:

```python
viewer = mv.Molvis(transport=mv.WebSocketTransport(
    page_base_url="https://molvis.dev/app",   # host page on a CDN
    port=8765,                                # fixed port instead of OS-assigned
    open_browser=False,
))
```

Token authentication is automatic: the page URL carries a one-time
token that the frontend must echo back in its hello handshake.

## Scene registry

```python
a = mv.Molvis()                # default scene
b = mv.Molvis()
assert a is b                  # same instance

protein = mv.Molvis(name="protein")
ligand  = mv.Molvis(name="ligand")
mv.Molvis.list_scenes()
mv.Molvis.get_scene("protein")
protein.close()                # stop transport + drop from registry
```

## Drawing API

```python
scene = mv.Molvis()
scene.set_style(style="ball-and-stick")  # one global representation
scene.draw_frame(frame)
scene.draw_box(box)
scene.draw_atoms(atoms)
scene.new_frame()
scene.set_style(style="spacefill", atom_radius=0.5)
scene.set_style(style="skeletal", outline=True)
scene.draw_frame(frame)          # data only; global style is unchanged
scene.set_theme("modern")        # "classic" | "modern"
scene.clear()
```

### Query commands (block until the frontend responds)

```python
png_bytes = scene.snapshot()
frame     = scene.export_frame()
selected  = scene.get_selected()    # mp.Frame with just the selection
scene.select_atom_by_id([0, 2])
```

## Palette utilities

```python
import molvis as mv
from IPython.display import Image

scene = mv.Molvis()
scene                              # render the cell mount first

scene.list_palettes()
scene.palette_entries("cpk")[:5]
scene.palette_colors("glasbey-vivid")[:8]

png = scene.palette_preview("glasbey-vivid")
Image(data=png)
```

## Error handling

Fire-and-forget commands (e.g. `draw_frame`) log errors asynchronously.
Query commands raise `MolvisRPCError`:

```python
try:
    scene.export_frame()
except mv.MolvisRPCError as exc:
    print(exc.code, exc)
```

## Development

```bash
npm run build:page                   # build page bundle + copy to dist/
cd python && python -m pytest tests/ -v
```

## Packaging

```bash
npm run build:page
cd python && python -m build --wheel
```
