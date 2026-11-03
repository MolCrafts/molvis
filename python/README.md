# molvis

Python package for MolVis molecular visualization and agent control. A single
`mv.Molvis()` class works from both plain Python scripts (opens a
browser tab) and Jupyter notebooks (mounts the page bundle inline in
the cell, isolated by Shadow DOM — no iframe). Both hosts drive the
same page bundle over a local WebSocket.

## Installation

```bash
pip install molcrafts-molvis
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

## Agent control and visual feedback

MolVis can act as the review surface for an agent. The agent drives the scene
through structured RPC calls; the user reviews the rendered result and selects
the atoms or bonds that express their feedback.

```python
viewer.set_view_mode("select")

# Ask the user to select the region that needs another pass.
event = viewer.wait_for("selection_changed", timeout=120)
selected = viewer.get_selected()  # complete standalone molecular subset

feedback = {
    "frame": viewer.current_frame,
    "atom_ids": event["atom_ids"],
    "bond_ids": event["bond_ids"],
    "selection": selected,
    "snapshot": viewer.snapshot(),
}
# Pass `feedback` to the agent and retain it in the host's audit record.
```

The viewer makes each agent action visible and returns user intent as molecular
data rather than screen coordinates. For durable auditing, the host should log
RPC requests/responses together with frame number, selection IDs, and optional
snapshots.

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
scene.set_theme("tab10")        # "tab10" | "ovito"
scene.clear()
```

### Query commands (block until the frontend responds)

```python
png_bytes = scene.snapshot()
frame     = scene.export_frame()
selected  = scene.get_selected()    # mp.Frame with just the selection
scene.select_atom_by_id([0, 2])
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
# one-shot: build page → copy into python/src/molvis/dist/
npm run build:page

# watch: rebuild straight into python/src/molvis/dist/ on TS changes
# (refresh the browser / notebook to pick up new hashes)
npm run dev:python

cd python && python -m pytest tests/ -v
```

The package ships a single ``dist/`` tree (``index.html`` + ``js/`` / ``css/`` /
``wasm/``). There is no nested ``dist/static/``.

## Packaging

```bash
npm run build:page
cd python && python -m build --wheel
```
