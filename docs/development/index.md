# Development

The MolVis engine is published as the npm package
[`@molcrafts/molvis-stage`](../api/typescript.md). This section is for
developers who want to **embed** MolVis in their own application or
**extend** it with custom behavior. If you're a user trying to visualize
molecules, begin with the [Tutorial](../tutorial/index.md)
instead.

## What you will find here

- [**Embedding**](setup.md) — add MolVis to your own web app, wire up
  the viewport, load a frame.
- [**Testing**](testing.md) — one Node unit lane per package, what a unit
  test may not touch, and how to prove a test can actually fail.
- [**Extending**](extending.md) — write a custom modifier, register a
  new command, add a mode, plug a renderer into the scene.
- [**Page plugins**](plugins.md) — domain-oriented ESM plugins
  (modifiers, modes, analysis, commands, settings, RPC).
- [**Headless rendering**](headless-rendering.md) — scripted snapshots,
  turntables, and trajectory animations.
- [**OVITO parity**](ovito-parity.md) — modifier placement and the shipped
  OVITO-shaped pipeline catalog.
- [**PCA tool**](pca-tool.md) — project per-frame properties to a 2-D scatter.

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
  export of `@molcrafts/molvis-stage`.
- [Python API Reference](../api/python.md) — the Jupyter widget
  surface.
- [MolVis on GitHub](https://github.com/molcrafts/molvis) — source,
  issues, and release history.

## Working against molpy

Python uses the folded package in the sibling molrs checkout
(`../molpy/molpy`), configured in `python/pyproject.toml`. CI checks out
the unified layout at `MOLPY_REF` in `.github/partners.env`. The pinned
commit must be available on MolCrafts/molpy; see the current
[source availability constraint](testing.md#partners).
TypeScript uses the sibling checkout’s `@molcrafts/molwasm` build, declared
as `file:../../molpy/molwasm/pkg` in `core/package.json`. Only `core/`
imports it (`npm run check:molrs-gateway`); consumers keep using the public
`@molcrafts/molvis-core/molrs` gateway. Build it before installing dependencies;
see [the prerequisites](testing.md#partners).

```bash
npm run build:molwasm
npm install
npm run build:packages
npm run typecheck
npm test
```

Species is `atoms.atomic_number` (u64; 0 is wildcard). MolVis derives display
symbols from it and accepts raw `element` symbols at file boundaries. Chemistry
converts symbols with molrs `fillAtomicNumbers`; symbol-based exports convert
an owned copy with `fillSymbols`. `Box` takes a `Cell`, an origin and a
three-boolean PBC tuple. Perception modifies an owned copy. Mrec uses
`new MrecReader(source)` / `new MrecFile(source)`, and streamed frames use
`readWireFrame(payload, encoding)`. MSD and VACF receive arrays of per-frame
records rather than a stacked trajectory object.
