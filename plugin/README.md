# `@molcrafts/molvis-plugin`

Authoring SDK for MolVis page plugins. Import this package — never monorepo
`page/` paths:

```ts
import { MolvisPlugin, type PluginAPI, pluginExternals, token } from "@molcrafts/molvis-plugin";
import { Button, Checkbox } from "@molcrafts/molvis-plugin/ui";
import "@molcrafts/molvis-plugin/css"; // shadcn CLI anchor only
```

The umbrella re-exports the same values under `@molcrafts/molvis/plugin*`.
Prefer the scoped spelling: it is the package the host injects.

Scaffold a new plugin from
[molvis-plugin-template](https://github.com/MolCrafts/molvis-plugin-template)
(`npx molvis-plugin create` once that CLI is on npm; until then run
`node bin/molvis-plugin.mjs create` from a checkout).

## Exports

| Path | Contents |
|------|----------|
| `@molcrafts/molvis-plugin` | `MolvisPlugin`, contract types, tokens, `cn`, `pluginExternals` |
| `@molcrafts/molvis-plugin/ui` | Host-aligned shadcn (`Button`, `Checkbox`, `Select`, …) |
| `@molcrafts/molvis-plugin/css` | CSS anchor for shadcn CLI (theme is host-owned) |
| `@molcrafts/molvis-plugin/components.json` | shadcn config |

Runtime theme tokens (`--molvis-*`) are provided by the MolVis host; do not ship a second palette.
