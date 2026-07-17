# The modifier pipeline

The **pipeline** is an ordered transformation from loaded source data to the
frame that MolVis renders. It makes data operations visible, reorderable, and
undoable instead of hiding them in one-off UI actions.

## Read a pipeline from top to bottom

Consider this sequence:

```text
DataSource → Slice → ExpressionSelect → ColorByProperty → rendered frame
```

Each modifier receives the previous modifier's output. Reordering therefore
changes meaning. Selecting atoms before slicing can preserve a named selection
that includes atoms later removed from view; slicing first limits what the
expression can see.

## Source versus derived frame

The DataSource modifier owns the original structure or trajectory. Later
modifiers operate on working frames. This gives MolVis two useful guarantees:

- disabling or deleting a modifier can recover upstream data;
- exporting the rendered result does not require overwriting the original file.

The scene is rebuilt from the active pipeline output. Representation remains a
global visual setting outside the molecular data path, so changing from
wireframe to spacefill does not insert a modifier.

## Common modifier categories

| Category | Examples | Effect |
|---|---|---|
| Filter | Slice, Hide selection | Remove atoms from downstream output |
| Selection | Expression select | Create/update a named target set |
| Appearance data | Color by property, Assign color | Add per-atom color information |
| Coordinates | Wrap PBC | Produce transformed positions |
| Source composition | Data source | Choose or combine input data |

Use the eye control to mute a modifier without deleting its configuration.
Drag to reorder. Use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z to undo and redo command
history.

## A prediction exercise

Imagine selecting `element O`, assigning those atoms red, then hiding the same
selection. The color modifier still runs, but its result is invisible because a
later modifier removes the target atoms. Moving Hide selection above Assign
color means the color modifier receives no selected oxygen atoms.

## Checkpoint

Given two modifiers, you should be able to ask which one receives the other's
output. Next, add time by learning how a [trajectory](trajectory.md) supplies a
different source frame at each index while reusing one pipeline definition.
