# Molvis in Jupyter

The same `mv.Molvis()` class used in scripts also renders inline in
Jupyter. Under the hood, a local WebSocket server is started and the
cell mounts the shared page bundle directly into the cell output (a
Shadow DOM root keeps the page's CSS from leaking into the notebook —
no iframe involved).

## Constructor

``` python
scene = mv.Molvis(
    name: str = "default",
    *,
    transport: Transport | None = None,
    width: int = 1200,
    height: int = 800,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `str` | `"default"` | Scene name; identical names return the cached instance |
| `transport` | `Transport \| None` | `None` | Override the default `WebSocketTransport` |
| `width` | `int` | `1200` | Cell-host width in CSS pixels |
| `height` | `int` | `800` | Cell-host height in CSS pixels |

## Display

Return the scene object at the end of a cell to render it:

``` python
scene = mv.Molvis(name="demo")
scene.draw_frame(frame)
scene
```

The cell loads the page bundle's hashed `<script>` chunks once per
notebook (subsequent cells reuse the in-flight load promise) and then
calls `window.MolvisApp.mount(cellDiv, opts)`. The mount creates a
Shadow DOM root, attaches the page's stylesheet inside it, then
renders the React app and dials back to the Python-hosted WebSocket.

## Scene management

### `Molvis.get_scene(name)`

Retrieve a previously created scene by name.

``` python
scene = mv.Molvis.get_scene("protein_view")
```

### `Molvis.list_scenes()`

List all named scenes in the current Python process.

``` python
names = mv.Molvis.list_scenes()  # ["default", "protein", "ligand"]
```

### `scene.close()`

Stop the transport and drop the scene from the registry.

## Drawing commands

Command mixins are unchanged:

``` python
scene.set_style(style="ball-and-stick")
scene.draw_frame(frame)
scene.draw_box(box)
scene.clear()
scene.set_style(style="spacefill")
scene.set_theme("modern")
scene.snapshot()
scene.export_frame()
scene.get_selected()
scene.select_atom_by_id([0, 2])
```

## Event channel

``` python
scene.on("selection_changed",
         lambda ev: print(ev["atom_ids"]))
scene.wait_for("frame_changed", timeout=10.0)

scene.selection       # Selection(atom_ids=..., bond_ids=...)
scene.current_mode    # cached string
scene.current_frame   # cached int
```

Callbacks fire on the transport's asyncio thread — not the main
kernel thread. For synchronous flows, prefer `wait_for`.

## Binary transport

Numeric numpy arrays are lifted out of JSON into binary buffers on the
WebSocket frame, avoiding JSON expansion of large coordinate arrays.
