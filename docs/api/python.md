# Python API Reference

The `molvis` Python package drives the same page bundle that powers the
standalone web app. A single `mv.Molvis()` class works from both plain
scripts and Jupyter notebooks — in the former it opens a browser tab,
in the latter it mounts the same page bundle inline in the cell output
(via a Shadow DOM root for style isolation, no iframe). In both cases
communication is JSON-RPC 2.0 over a local WebSocket with token auth.

## Install

```bash
pip install molcrafts-molvis
```

```python
import molvis as mv
```

Requires Python 3.12+. The page bundle ships inside the wheel; no
separate frontend installation is needed.

## `Molvis`

### Constructor

```python
mv.Molvis(
    name: str = "default",
    *,
    transport: Transport | None = None,
    width: int = 1200,
    height: int = 800,
)
```

- **`name`** — registry key for `Molvis.get_scene(name)`. Duplicate
  names return the cached instance (no second transport started).
- **`transport`** — override the default `WebSocketTransport`. Pass a
  custom transport to host the page on a CDN, pin a port, or plug in a
  fake for tests.
- **`width`, `height`** — cell mount size in CSS pixels (Jupyter host
  only; standalone uses the browser viewport).

### Drawing

```python
scene.draw_frame(frame)                 # render a single frame
scene.draw_box(box)                     # add a simulation box
scene.set_style(style="spacefill")      # one global molecular style
scene.set_style(style="skeletal", outline=True)
scene.snapshot()                         # → PNG bytes
```

`style` accepts `ball-and-stick`, `flat`, `ball-and-tube`, `tube`,
`metal-tube`, `wireframe`, `bubble`, `spacefill`, `skeletal`, or `graph`.
The optional heavy outer outline is available only for the 2-D-like `flat`,
`skeletal`, and `graph` representations. Drawing another frame does not reset
the selected style. See [Molecular representations](../tutorial/representations.md).

`frame` is a `molpy.Frame`. Dense numeric arrays are shipped as binary
buffers, so million-atom frames don't balloon the JSON message.

### Events & cached state

Canvas interactions flow back to Python as JSON-RPC notifications.
Registered callbacks fire immediately; cached state properties stay
current without polling.

```python
handle = scene.on("selection_changed",
                  lambda ev: print(ev["atom_ids"]))
handle.remove()

ev = scene.wait_for("selection_changed", timeout=30)

scene.selection         # Selection(atom_ids=(...), bond_ids=(...))
scene.current_mode      # "view" | "select" | "edit" | "measure" | "manipulate"
scene.current_frame     # int
```

Callbacks run on the transport's asyncio thread; `wait_for` is
main-thread-safe and is preferred for synchronous workflows.

### Registry

```python
mv.Molvis.list_scenes()          # -> ['default', 'protein', ...]
mv.Molvis.get_scene("protein")   # -> existing Molvis
scene.close()                     # stop transport + drop from registry
```

### Error handling

Fire-and-forget commands log errors asynchronously. Query commands
surface frontend exceptions as `mv.MolvisRPCError`:

```python
from molvis import MolvisRPCError

try:
    scene.export_frame()
except MolvisRPCError as exc:
    print(exc.code, exc)
```

## `WebSocketTransport`

The sole transport implementation. By default, serves the bundled
`dist/` on an OS-assigned port, generates a random token, and
opens the browser (outside Jupyter).

```python
mv.WebSocketTransport(
    page_base_url=None,    # external base URL where the page is hosted
    host="localhost",
    port=0,                # 0 = pick a free port
    token=None,            # auto-generated if None
    open_browser=True,
)
```

- `page_base_url=None` → the transport serves `dist/` itself on
  the same port as the WebSocket.
- `page_base_url="https://cdn.example/app"` → the transport serves
  only the WebSocket endpoint; the page bundle is fetched from the
  CDN. The Jupyter cell loader resolves all `<script>` and `<link>`
  asset URLs relative to this base.

The handshake is:

    client → server   {"type":"hello", "token":"…", "session":"…"}
    server → client   {"type":"ready"}                   (✓)
                      ws.close(1008, "auth")              (✗ token mismatch)

After `ready`, JSON-RPC 2.0 flows in both directions (requests with
`id`, notifications without).

## Worked example

```python
import molpy as mp
import molvis as mv

frame = mp.Frame(
    elements=["O", "H", "H"],
    positions=[(0, 0, 0), (0.9572, 0, 0), (-0.2399, 0.9266, 0)],
)

scene = mv.Molvis(name="water", width=600, height=400)
scene.draw_frame(frame)
scene.set_view_mode("select")
scene
```

Click on the oxygen atom in the canvas, then:

```python
print(scene.selection.atom_ids)
# -> (0,)
```
