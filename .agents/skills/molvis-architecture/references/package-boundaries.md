# Package boundaries

| Package | Owns | Depends inward on |
|---|---|---|
| `core` | MolRS gateway, element data, shared framework-free primitives | MolRS/MolWASM |
| `stage` | 3D engine, pipeline, scene, analysis routing, RPC | core, Babylon |
| `sketch` | 2D graph, board, geometry, reversible editing | core |
| `stage-viewer` | Stage custom elements and standalone host | Stage/core |
| `sketch-viewer` | Sketch custom element and standalone companion surface | Sketch; Stage in the companion host |
| `plugin` | Public plugin authoring contracts and UI | Public engine APIs |
| Root `src` | Thin umbrella exports | Published engine/SDK packages |
| `page` | React application, chrome, plugin loading, charts | Public packages |
| `vsc-ext` | Extension activation, files, webview transport | Public packages |
| `python` | Controller, WebSocket transport, bundled page | Public wire protocol |

## Import and export contracts

- Only `core/` imports `@molcrafts/molrs` or `@molcrafts/molwasm` directly.
  Other packages use `@molcrafts/molvis-core/molrs` or other core exports.
- Stage and Sketch engines do not import each other. A host may compose both.
- Custom-element implementations live in the viewer packages. Engine packages
  do not acquire `./element` or `./viewer` entrypoints.
- Hosts import `@molcrafts/molvis-stage`, `@molcrafts/molvis-sketch`, and core
  subpaths through package exports. Do not add aliases into engine sources.
- Stage's `./io` and `./io/formats` are public APIs. Preserve their contracts
  when changing implementation details.
- Stage's worker-spawner and trajectory-runtime self-imports use the `source`
  export condition for typechecking. Preserve written package specifiers in
  emitted declarations; a tsconfig path rewrite to internal `.ts` files breaks
  consumers and clean builds.
- Plugins consume the public `@molcrafts/molvis/plugin` SDK, never page internals.
- Core owns no Babylon, React, pipeline, RPC, or charting implementation.
  Charts belong to `@molcrafts/molplot`; hosts present them.

## Build ownership

Read `package.json` and each package's Wireit configuration for the current
graph. `build:packages` builds the libraries and viewers; `build` also builds
the page, Python bundles, and extension. `dev:page` delegates dependency watches
to Wireit. Watch builds retain existing output while rebuilding so dependent
packages can keep resolving exports.

Constraints belong in package commands and CI, build steps in build configs,
and release packaging in workflows. Do not create a parallel script framework.
