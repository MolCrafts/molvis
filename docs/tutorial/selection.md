# Selection and interaction mode

A **selection** is persistent state containing atom and bond identifiers. An
**interaction mode** decides what a pointer gesture means. These are separate:
changing mode does not automatically clear the selection.

## Why modes exist

The same left-click cannot safely mean “orbit”, “select an atom”, “place a new
atom”, and “add a measurement anchor” at the same time. MolVis therefore makes
one mode active:

| Key | Mode | Pointer intent |
|---|---|---|
| `1` | View | Move the camera |
| `2` | Select | Update atom/bond selection |
| `3` | Edit | Stage topology edits |
| `4` | Manipulate | Transform a selected group |
| `5` | Measure | Place distance/angle/dihedral anchors |

The View mode is the safe fallback. Small embeds can enable only View and
Select, preventing edit or manipulation commands from being entered at all.

## Try a restricted viewer

Click the viewer, press `2`, then click an atom. Hold Shift to extend the
selection and Ctrl/Cmd to toggle membership. Press `1` to return to camera
navigation; the selected identifiers remain selected.

```molvis {format="xyz" controls="view mode context-menu" modes="view select" mode="view"}
5
name=methane Connct="[0,1,0,2,0,3,0,4]"
C  0.000  0.000  0.000
H  0.629  0.629  0.629
H -0.629 -0.629  0.629
H -0.629  0.629 -0.629
H  0.629 -0.629 -0.629
```

## Selection is data for later operations

Selection by itself does not remove or recolor atoms. It supplies a target to
commands and modifiers. For example, a later pipeline modifier can hide the
selected atoms or assign them a fixed color. Manipulate mode can translate the
same set as a rigid group. Python event handlers can receive the selected atom
IDs without polling.

## Checkpoint

Be able to distinguish “which atoms are selected?” from “what will the next
click do?”. The first is selection state; the second is mode. The
[modifier pipeline](pipeline.md) is where selection can become an explicit,
reproducible data transformation.
