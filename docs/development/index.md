# Development

The MolVis engine is published as the npm package
[`@molcrafts/molvis-core`](../api/typescript.md). This section is for
developers who want to **embed** MolVis in their own application or
**extend** it with custom behavior. If you're a user trying to visualize
molecules, begin with the [Tutorial](../tutorial/index.md)
instead.

## What you will find here

- [**Embedding**](setup.md) — add MolVis to your own web app, wire up
  the viewport, load a frame.
- [**Extending**](extending.md) — write a custom modifier, register a
  new command, add a mode, plug a renderer into the scene.
- [**Headless rendering**](headless-rendering.md) — run the WebGL2 visual
  smoke suite or author deterministic representation and surface captures.

## The 30-second mental model

```
┌─────────────────────────────────────────────────────────────────┐
│ MolvisApp                                                       │
│                                                                 │
│   ┌──────────────┐   ┌────────────────┐   ┌──────────────┐      │
│   │ World        │   │ System         │   │ Artist       │      │
│   │ scene,camera │   │ trajectory,    │   │ thin-instance│      │
│   │ lights       │   │ frame events   │   │ rendering    │      │
│   └──────────────┘   └────────────────┘   └──────────────┘      │
│          ▲                    ▲                   ▲             │
│          │                    │                   │             │
│   ┌──────┴──────┐   ┌─────────┴────────┐   ┌──────┴──────┐      │
│   │ ModeManager │   │ ModifierPipeline │   │ SceneIndex  │      │
│   │ 5 modes     │   │ modifier chain   │   │ GPU buffers │      │
│   └─────────────┘   └──────────────────┘   └─────────────┘      │
│          ▲                                                      │
│          │                                                      │
│   ┌──────┴──────────────────────────────────────────────┐       │
│   │ CommandManager — undo/redo, command registry        │       │
│   └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

Every user action flows through **commands** (so everything is
undoable). Data flows through the **pipeline** (so rendering always
reflects a deterministic function of the frame). The **Artist** owns
the GPU buffers and translates frame data into thin-instance draw
calls.

Knowing which layer a change belongs to is the most important skill
when working on MolVis. The [Extending](extending.md) page has the
layer cheatsheet.

## Related reading

- [TypeScript API Reference](../api/typescript.md) — every public
  export of `@molcrafts/molvis-core`.
- [Python API Reference](../api/python.md) — the Jupyter widget
  surface.
- [MolVis on GitHub](https://github.com/molcrafts/molvis) — source,
  issues, and release history.
