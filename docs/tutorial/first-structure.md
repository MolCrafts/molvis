# Your first structure

The first concept is the **frame**: the molecular data MolVis receives for one
point in time. A frame normally contains an atoms table, may contain a bonds
table, and may carry a periodic simulation box and additional per-atom
properties.

## Read the source before the picture

The example below uses XYZ, a deliberately small text format:

```text
3
name=water Connct="[0,1,0,2]"
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
```

The first line declares three atoms. The comment line names the frame and uses
MolCrafts' `Connct` extension to declare the zero-based atom pairs 0–1 and 0–2.
Every remaining line supplies an element symbol and Cartesian coordinates in
ångström. This explicit topology keeps the two O–H bonds stable instead of
depending on geometry inference.

## Load it through the formatter

```molvis {format="xyz" controls="view"}
3
name=water Connct="[0,1,0,2]"
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
```

The fenced block is not a screenshot. At documentation-build time the MolCrafts
theme validates the declaration and emits a `molvis-viewer` Web Component. In
the browser, the normal MolVis XYZ loader creates a frame and sends it through
the same render path used by the application and language bindings.

## Data source, frame, and scene

These three layers are related but not interchangeable:

1. The **data source** remembers where the XYZ content came from.
2. The loader parses the source into a **frame**.
3. MolVis builds visible meshes and materials in the **scene**.

Reloading the source can replace the frame. Orbiting the camera only changes the
scene view. A representation change rebuilds visible geometry but keeps the
frame's coordinates and properties.

## Checkpoint

You should now be able to say what the three atoms are and where their
coordinates came from. Do not worry about orbiting yet; that is the single
subject of [Camera and viewport](camera.md).
