# Notebook scenes

In a notebook, displaying a `Molvis` object creates the browser-side client.
Commands sent afterward update that mounted canvas rather than creating a new
widget for every cell.

## Create and display first

```python
import molvis as mv

scene = mv.Molvis(name="lesson", width=760, height=520)
scene
```

Keep the scene name stable. Constructing `Molvis(name="lesson")` again returns
the registered instance, which prevents accidental duplicate transports.

## Send data in a later cell

```python
scene.draw_frame(frame)
scene.set_style(style="ball-and-stick")
```

Command methods return the scene for chaining. After the first rich display,
their automatic representation is a compact status line so the notebook does
not clone the full viewer repeatedly.

## Display the same scene again

```python
scene.show()
```

`show()` marks the next rich display as a fresh mount. It does not create a new
Python scene or copy the pipeline. Use it when a later section of the notebook
needs another live view of the same named session.

## Canvas-only output

```python
preview = mv.Molvis(
    name="figure",
    gui=False,
    width=640,
    height=420,
)
preview
```

`gui=False` removes page chrome and controls. Python commands, the renderer,
pipeline, representation, and event channel remain available.

## Close notebook resources

```python
scene.close()
mv.Molvis.close_all()
```

Closing stops the transport, removes the registry entry, and releases the
browser session. This matters in long-running kernels that create many named
scenes.

Continue with [Python scripts](scripts.md).
