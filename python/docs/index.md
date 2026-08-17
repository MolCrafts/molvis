# MolVis

MolVis is a Python package for interactive 3D molecular visualization.
One class — `mv.Molvis()` — works from both plain Python scripts and
Jupyter notebooks. The same page bundle is driven over a local
WebSocket regardless of host.

## Installation

``` bash
pip install molcrafts-molvis
```

## Hello, molecule

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
viewer.draw_frame(frame)
```

In a plain script the call opens the default browser; in a Jupyter
cell, ending the cell with `viewer` (or `scene`) mounts the same
viewer inline in the cell output (Shadow DOM keeps the page's CSS
isolated — no iframe).

## Two hosts at a glance

=== "Script / CLI"

    ``` python
    viewer = mv.Molvis()
    viewer.draw_frame(frame)
    viewer.snapshot()                     # PNG bytes
    ```

=== "Jupyter notebook"

    ``` python
    scene = mv.Molvis(name="demo")
    scene.draw_frame(frame)
    scene                                  # renders inline
    ```

## Bidirectional events

Canvas interactions flow back to Python. Selection is a shared state.

``` python
viewer.on("selection_changed",
          lambda ev: print("atoms:", ev["atom_ids"]))

ev = viewer.wait_for("selection_changed", timeout=30)

viewer.selection      # Selection(atom_ids=(...), bond_ids=(...))
viewer.current_mode   # "view" | "select" | "edit" | ...
```
