# Drawing Commands

These methods are available on every [`Molvis`](jupyter.md) instance,
regardless of host (script, notebook, or CDN-hosted page).

## Scene

### `draw_frame(frame, style=None, atom_radius=None, bond_radius=None)`

Draw a molecular frame, replacing the current scene content.

``` python
scene.draw_frame(frame)
scene.draw_frame(frame, style="spacefill")
scene.draw_frame(frame, style="ball_and_stick", atom_radius=0.3)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `frame` | `mp.Frame` | required | Frame to render |
| `style` | `str \| None` | `None` | `"ball_and_stick"`, `"spacefill"`, or `"wireframe"` |
| `atom_radius` | `float \| None` | `None` | Atom radius scale factor |
| `bond_radius` | `float \| None` | `None` | Bond radius scale factor |

### `draw_box(box)`

Draw a simulation box wireframe.

``` python
scene.draw_box(box)
```

### `draw_atoms(atoms, style=None)`

Draw individual atoms (without bonds).

``` python
scene.draw_atoms(atoms_frame, style="spacefill")
```

### `clear()`

Clear all objects from the scene.

``` python
scene.clear()
```

### `new_frame(clear=True)`

Create an empty frame. If `clear=True`, clears the current scene.

``` python
scene.new_frame()
```

## Style

### `set_style(style=None, atom_radius=None, bond_radius=None)`

Change the visual style without reloading the frame data.

``` python
scene.set_style(style="spacefill")
scene.set_style(atom_radius=0.5, bond_radius=0.1)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `style` | `str \| None` | `None` | `"ball_and_stick"`, `"spacefill"`, or `"wireframe"` |
| `atom_radius` | `float \| None` | `None` | Atom radius scale factor |
| `bond_radius` | `float \| None` | `None` | Bond radius scale factor |

### `set_theme(theme)`

Switch the color theme.

``` python
scene.set_theme("modern")
scene.set_theme("classic")
```

| Value | Description |
|-------|-------------|
| `"classic"` | CPK-based coloring |
| `"modern"` | Contemporary palette |

### `set_view_mode(mode)`

Switch the interaction mode.

``` python
scene.set_view_mode("select")
```

| Value | Description |
|-------|-------------|
| `"view"` | Camera orbit / pan / zoom |
| `"select"` | Click to select atoms |
| `"edit"` | Add / delete atoms |
| `"manipulate"` | Transform selected groups |
| `"measure"` | Distance, angle, dihedral |

## Pipeline

The modifier pipeline is the single source of truth for scene content:
every frame — whether loaded via the sidebar's **Load File** button or
pushed from Python with `draw_frame` / `set_trajectory` — flows through
a `DataSourceModifier` at the head, followed by user-added modifiers
(selection, hide, color, …). The GUI sidebar and these Python commands
manipulate the same pipeline, so toggling a modifier from Python is
indistinguishable from clicking it in the sidebar.

### `list_modifiers()`

Snapshot the current pipeline, in execution order.

``` python
for m in scene.list_modifiers():
    print(m.name, m.id, "enabled" if m.enabled else "off")
```

### `available_modifiers()`

List every modifier type registered in the frontend's `ModifierRegistry`.
Use the `name` field with `add_modifier`.

``` python
for entry in scene.available_modifiers():
    print(entry.name, "—", entry.category)
```

### `add_modifier(name, *, selection_scope_id=None, source_owner_id=None, enabled=None)`

Append a modifier to the pipeline.

``` python
scene.add_modifier("Hide Hydrogens")
sel = scene.add_modifier("Expression Select")
scene.add_modifier("Hide Selection", selection_scope_id=sel.id)
```

Selection-sensitive modifiers must attach to a selection-producing
modifier via `selection_scope_id`. Use `source_owner_id` only for tree
ownership under a data source.

### `remove_modifier(id)` / `clear_pipeline()`

``` python
scene.remove_modifier(mod.id)   # cascade-removes descendants
scene.clear_pipeline()          # drop every modifier
```

### `reorder_modifier(id, new_index)`

``` python
scene.reorder_modifier(mod.id, 0)   # move to head
```

### `set_modifier_enabled(id, enabled)` / `set_modifier_selection_scope(id, selection_scope_id)` / `set_modifier_source_owner(id, source_owner_id)`

``` python
scene.set_modifier_enabled(mod.id, False)
scene.set_modifier_selection_scope(mod.id, None)          # detach selection
scene.set_modifier_selection_scope(mod.id, selector.id)   # consume selector
scene.set_modifier_source_owner(mod.id, source.id)         # tree ownership
```

## Selection

### `get_selected()`

Return the current selection state.

``` python
selection = scene.get_selected()
```

### `select_atom_by_id(ids)`

Select atoms by their indices.

``` python
scene.select_atom_by_id([0, 2, 5])
```

## Export

### `snapshot()`

Capture the current view as PNG bytes.

``` python
png_data = scene.snapshot()

with open("molecule.png", "wb") as f:
    f.write(png_data)
```

### `export_frame()`

Read back the current frame data from the frontend.

``` python
frame_data = scene.export_frame()
```

## Error handling

All commands communicate with the frontend via JSON-RPC. If the frontend rejects a command, Python raises `MolvisRPCError`:

``` python
try:
    scene.draw_frame(frame)
except mv.MolvisRPCError as exc:
    print(f"Error {exc.code}: {exc}")
```
