---
name: molvis-workbench
description: >
  Drive a live MolVis viewer through a conversation — open a session, run
  molvis/molpy Python inside it, poll the events the browser sends back, and
  read the user's selection instead of guessing it. Use when the user wants to
  see, draw, inspect or edit a structure in 3D, or when they point at
  something on the canvas.
when-to-use: >
  Load when a task involves showing a molecule, drawing into a viewer,
  reacting to what the user selected on screen, or iterating on a structure
  visually. Also when the molvis MCP tools are available and the user asks to
  "look at" a structure.
user-invocable: true
disable-model-invocation: false
metadata:
  author: MolCrafts
  short-description: One session, Python inside it, events back from the canvas.
---

# MolVis workbench

The user says "make me an aspirin", watches the 3D structure appear in a
browser, clicks part of it, and says "change this". This page teaches the
**loop** that makes that work.

It documents **no** molvis or molpy method as fact. The `capabilities` tool
reflects the live scene, and molpy's truth is in the installed package's own
docstrings — both are one call away, and both outrank this page.

## One session, two surfaces, two wills

A session is one live molvis scene held inside the `molvis-mcp` process,
together with a Python namespace bound to it. Four parties share it:

- the **human** watches and clicks;
- the **canvas** is the browser page molvis renders — it projects the
  structure and streams interaction events back;
- the **code surface** is the persistent namespace, where `viewer` is the
  scene and anything you bind (`mol`, a frame, a selection) is still bound on
  your next call;
- **you** hold only the tools below, and never touch the canvas directly.

Two wills act on one session and neither blocks the other. The human's
"change *that* bit" reaches you as an event you poll for; your "apply what we
agreed" reaches them as the next redraw. They meet in session state, nowhere
else.

## The loop

`open` → `exec` (build and draw) → the human looks and clicks →
`poll_events` → `exec` (read the selection, edit, redraw) → `close`.

Step one, once `open` has returned **and the user has opened the
`connection_url`**: build the structure and put it on the canvas. `viewer` is
already bound; nothing else is imported for you.

Building it is molpy's job, so the call belongs to molpy and this page does not
name it — read it from the package that is installed, then `exec` it:

1. Locate that install and read the public `__all__` of the subpackage that
   owns the task.
2. Open the object's source and use the signature in that file.
3. `exec` the two or three lines that build with what you read and hand the
   result to the drawing call.

A structure written as one line of text carries connectivity but no coordinates,
so something has to generate a conformer before anything can be drawn in 3D —
that is a second capability to resolve, not a step to skip.

The human now clicks part of the structure and `poll_events` hands you a
`selection_changed` record. Step two reads that selection back, edits, and
redraws. Note what is *not* here: no rebuild of `mol`, because the namespace
persisted.

```python
sel = viewer.get_selected()                  # a standalone sub-structure
# … edit with the molpy calls you resolved …
viewer.clear(); viewer.draw_frame(mol)       # refresh = clear, then draw
```

That is the whole pattern. Longer work is more turns of the same wheel, never
a bigger tool: no `show_smiles` tool is coming, because that vocabulary lives
in molvis and molpy and you already have a channel to it.

## The tools

| Tool | What it is for |
|---|---|
| `open` | start (or re-attach to) a named session; returns `connection_url` |
| `exec` | run Python in that session's namespace; a trailing expression comes back as a value |
| `poll_events` | events after a cursor — `selection_changed`, `mode_changed`, `frame_changed`, `hello_state` |
| `capabilities` | the live scene's methods, with signatures, as this build actually has them |
| `list_sessions` | which sessions are live, and what a previous turn left bound in each |
| `close` | tear one down |
| `refresh` | re-read edited pure-Python packages between calls |

## Three facts the loop depends on

These three are behaviours, not names. The names below are molvis's own and
ship in the same release as this page, so they are the one set this file may
carry — and `capabilities` is still what settles a signature:

- **`draw_frame` stamps** — it places a structure onto the canvas and does not
  wipe what is already there, so a refresh is `clear()` and *then*
  `draw_frame(...)`.
- **`get_selected` returns a standalone sub-structure** — with its own atoms and
  coordinates, renumbered, not a list of indices into what you drew.
- **The namespace persists across `exec` until `close`** — every binding
  survives, and is released only by `close`.

## Grounding

Never invent a method. Before you call something you have not called in this
session:

- for the scene: `capabilities` — it reflects the live object, so what comes
  back is what this build has;
- for anything outside molvis: the installed package's `__all__` and the source
  of the object you will call.

A name that is not on that public surface does not exist. Say what you opened
and which names were there, then stop — a guessed signature costs the user a
broken session and a false claim about what the library does.

## Connection etiquette

`open` returns a `connection_url`, and the viewer does not exist until a human
opens that URL in a browser. Put the link in your reply and wait to be told the
canvas is up. A `hello_state` event in `poll_events` is the canvas announcing
itself — that is your confirmation, not an assumption you may make.

## Editing molvis itself

If the user edits molvis or molpy on disk mid-session, `refresh` re-reads the
pure-Python parts. Read its answer: when `restart_required` is non-empty, a
compiled extension is still the old build, and a verdict you report from that
session is about code that never ran. Restart the server instead.
