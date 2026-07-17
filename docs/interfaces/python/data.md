# Frames, trajectories, and styles in Python

Python sends molecular data as `molpy.Frame` objects. Numeric arrays travel as
binary buffers instead of expanding into large JSON lists.

## Draw one frame

```python
scene.draw_frame(frame)
```

`draw_frame` replaces the active single-frame trajectory and refreshes the
pipeline. It does not reset representation or theme.

Objects with a `to_frame()` method can use:

```python
scene.draw_atomistic(molecule)
```

## Send a trajectory

```python
scene.set_trajectory(frames, boxes=boxes)
```

`frames` must contain at least one `molpy.Frame`. The optional boxes iterable
is parallel to the frames and may contain `None` entries.

## Set global visual state

```python
scene.set_style(style="skeletal", outline=True)
scene.set_background("#ffffff")
scene.set_theme("modern")
```

Available styles are `ball-and-stick`, `flat`, `ball-and-tube`, `tube`,
`metal-tube`, `wireframe`, `bubble`, `spacefill`, `skeletal`, and `graph`.
Outline is configurable only for `flat`, `skeletal`, and `graph`.

## Export molecular data

```python
current = scene.export_frame()
```

The returned frame reflects the current staged/pipeline scene content, not
necessarily the untouched source. Use `snapshot()` when the desired output is
PNG image bytes instead.

Continue with [Events and state](events.md).
