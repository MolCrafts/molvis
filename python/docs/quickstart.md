# Quick Start

## One class, two hosts

`mv.Molvis()` starts a local WebSocket server and drives the shared
frontend. In plain scripts it opens the default browser. In Jupyter it
mounts the same page bundle inline in the cell output (Shadow DOM
keeps the page's CSS isolated — no iframe).

``` python
import molvis as mv
import molpy as mp
import numpy as np

frame = mp.Frame(blocks={
    "atoms": {
        "x": np.array([0.0, -0.757, 0.757], dtype=np.float32),
        "y": np.array([0.0, 0.586, 0.586], dtype=np.float32),
        "z": np.array([0.0, 0.0, 0.0], dtype=np.float32),
        "element": ["O", "H", "H"],
    },
    "bonds": {
        "i": np.array([0, 0], dtype=np.uint32),
        "j": np.array([1, 2], dtype=np.uint32),
    },
})

viewer = mv.Molvis()
viewer.set_style(style="ball-and-stick")
viewer.draw_frame(frame)
```

In Jupyter, end the cell with `viewer` (or `scene`) to embed the viewer:

``` python
scene = mv.Molvis(name="protein_view", width=800, height=600)
scene.draw_frame(frame)
scene
```

## Canvas only (no UI chrome)

Pass `gui=False` to hide the TopBar, sidebars, and timeline — the page
bundle renders just the 3D canvas:

``` python
canvas = mv.Molvis(name="bare", gui=False, width=640, height=480)
canvas.draw_frame(frame)
canvas
```

Useful when you drive the viewer entirely from Python or embed it
inside your own UI.

## Bidirectional state

Canvas selection is observable from Python without polling.

``` python
viewer.on("selection_changed",
          lambda ev: print("atoms:", ev["atom_ids"]))

ev = viewer.wait_for("selection_changed", timeout=30)
print(viewer.selection)       # cached, updates live
```

## Drawing a simulation box

``` python
import molpy as mp

box = mp.Box.ortho(
    lengths=[10.0, 10.0, 10.0],
    origin=[0.0, 0.0, 0.0],
    pbc_x=True, pbc_y=True, pbc_z=True,
)

viewer.draw_box(box)
```

## Snapshot + close

``` python
png = viewer.snapshot()            # PNG bytes
viewer.set_style(style="spacefill")
viewer.set_theme("modern")
viewer.close()                      # stops transport
```

## CDN-hosted page

Point the browser at an externally-hosted bundle instead of the one
shipped with the Python package:

``` python
viewer = mv.Molvis(transport=mv.WebSocketTransport(
    page_base_url="https://molvis.dev/app",
    port=8765,
))
```
