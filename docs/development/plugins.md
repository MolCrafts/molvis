# Page plugins

MolVis loads third-party ESM plugins at runtime (Settings UI, VS Code
`molvis.plugins`, or Python `Molvis(plugins=[…])`).

## Domain-oriented contributions

Plugins extend **domains**. UI for a domain is registered **with that domain**
— there is no free-floating `api.ui` bag.

| Domain | Logic | UI (owned by the domain) |
|--------|--------|---------------------------|
| `modifiers` | pipeline factory | property panel (`register(..., { panel })`) |
| `modes` | interaction mode | tools panel (`register(..., { panel })` / `registerToolsPanel`) |
| `analysis` | compute | left Analysis picker + params + result (`register(spec)`) |
| `commands` | named action | optional toolbar (`register(..., { toolbar })`) |
| `overlays` | scene decoration | — |
| `settings` | plugin prefs | Settings section for *this* plugin |
| `rpc` | JSON-RPC | — |

Official scaffold (folders per domain) is the
[molvis-plugin-template](https://github.com/MolCrafts/molvis-plugin-template)
CLI. The package name is `molvis-plugin`; it is not on npm until that repo
is published — until then run the CLI from a checkout, or copy `template/`.

Official **collection** (meta + per-plugin packages, e.g. LAMMPS eq input):
[MolCrafts/molvis-plugins-official](https://github.com/MolCrafts/molvis-plugins-official).

### API sketch

```ts
api.modifiers.register("Scale X", "Modification", () => new ScaleXModifier(), {
  panel: ScaleXPanel,
});

api.analysis.register({
  id: "my-rdf",
  label: "My RDF",
  params: [{ name: "bins", label: "Bins", kind: "int", default: 50 }],
  run: async ({ app, params }) => ({ data: { /* … */ } }),
  resultKind: "scalar",
  // optional: renderResult: ({ result }) => <… />,
});

api.commands.register("export-csv", fn, {
  toolbar: { label: "Export CSV" },
});

api.modes.register("highlight", (app) => new HighlightMode(app), {
  panel: { id: "hl-tools", title: "Highlight", render: HighlightTools },
});
// Or extend a built-in mode's tools column:
api.modes.registerToolsPanel("view", {
  id: "extra",
  title: "Extra",
  render: ExtraViewTools,
});

api.settings.registerSection({
  id: "prefs",
  title: "My plugin",
  render: PrefsForm,
});

api.overlays.add(overlay);
api.rpc.registerMethod("ping", () => "pong");
```

## Install

Users only ever type a **GitHub repo** — never a release download URL.

1. **Settings → Plugins** — `owner/repo` (→ **latest Release**) or
   `owner/repo@v1.2.3`. Local debug only: `http://127.0.0.1:4173/`.
2. **VS Code** — `"molvis.plugins": ["owner/repo@v1.2.3"]` then reload view.
3. **Python** — `Molvis(plugins=["owner/repo@v1.2.3"])` or URL `?plugins=…`.

**What the host does:** short key → GitHub Release base
(`…/releases/download/{tag}/`) → fetch `molvis.plugin.json` → resolve relative
`entry` (`plugin.js`, or `dist/plugin.js` rewritten to flat `plugin.js` on
Release layout). Settings / storage keep `owner/repo[@tag]` only.

**Distribution:** plugins ship **built assets on GitHub Releases** (flat files:
`molvis.plugin.json` + `plugin.js` + any workers). `dist/` is **not** committed.
CI builds on every PR; tagging `v*` runs the release workflow and uploads assets.

Trust model: remote code runs in the page; no allowlist. Only install trusted sources.

`localStorage` (`molvis.plugins.v1`) persists Settings installs; host inject merges and enables listed sources.

## Package layout

What the scaffolder writes:

```
my-plugin/
  molvis.plugin.json           # entry: dist/plugin.js (local) / plugin.js (Release)
  .github/workflows/release.yml  # tag v* → build + flat assets on a Release
  dist/                        # gitignored — npm run build
  src/
    index.tsx                  # activate → domain registers (MolvisPlugin subclass)
    modifiers/…
    analysis/…
    commands/…
    settings/…
    modes/README.md            # prose: a real mode needs a pointer lifecycle
    overlays/README.md         # prose: overlays own Babylon meshes
```

There is no `scripts/` directory: packaging lives in the release workflow.

### Manifest

Repo-root `molvis.plugin.json` points at **relative** assets only — never absolute
CDN/release URLs. Users install the **repo**, not this file’s path.

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "0.2.0",
  "molvis": ">=0.2.0",
  "entry": "dist/plugin.js"
}
```

- **Local serve:** `entry` stays `dist/plugin.js` next to the repo-root manifest
  (or serve `dist/` and use a local manifest there).
- **Release packaging** (inline in the repo's `release.yml`): copies `dist/`
  top-level files flat, rewrites `entry` → `"plugin.js"`, and uploads them.
  The host also strips a leading `dist/` when `layout === "release"`, so a
  non-rewritten manifest still loads. The template's `release.yml` already
  does this rewrite.

### Multi-chunk

Host recursively rewrites **relative** imports under the entry URL into blob
modules. Everything in `pluginExternals` must stay external (see Build rules).
Workers for pyodide-kernel must sit next to `plugin.js` on the same Release.
## Build rules

Every module the host injects must be **external** in your bundle. Do not
retype the list — import it:

```ts
// rsbuild.config.ts — import the externals subpath so Node does not
// evaluate the SDK barrel (which pulls stage → molrs WASM).
import { pluginExternals } from "@molcrafts/molvis-plugin/externals";

export default defineConfig({
  output: { externals: pluginExternals },
});
```

`pluginExternals` covers `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`, `react/jsx-dev-runtime`, `@molcrafts/molvis-stage`,
`@molcrafts/molvis-stage/export-gltf`, `@molcrafts/molvis-plugin`,
`@molcrafts/molvis-plugin/ui`, `@molcrafts/molvis-core/{molrs,keys,elements}`,
and `@molcrafts/molplot`.

Note `@molcrafts/molvis-plugin` and `@molcrafts/molvis-plugin/ui` are listed
separately: a bundler treats a subpath as its own specifier, so externalizing
only the root still bundles the UI primitives.

Both directions of a mismatch break something, which is why the list is code
rather than prose:

- **externalized but not injected** → the bare specifier fails at runtime.
- **injected but not externalized** → a second copy of React/molrs/WASM, with
  class identities that are not `===` the host's.

The host's inject map (`page/src/plugins/host_shared.ts`) is checked against
this list with `satisfies` at compile time, so the two cannot drift apart
silently.

The SDK is a host module, not a vendored dependency. Bundling it pulls a
private copy of the shadcn primitives and their Radix/`clsx`/`tailwind-merge`
tree into every plugin — measured at 33.9 kB vs 2.3 kB for a hello-world
plugin, and 160 kB vs 40 kB for the LAMMPS generator. Two such plugins loaded
together also give the page two Radix trees, which `resolve.dedupe` cannot
prevent because it only dedupes within one bundle.

Radix, `clsx`, `class-variance-authority` and `tailwind-merge` still belong in
your **devDependencies** — the SDK's `.d.ts` files reference their types — but
never in `dependencies`.

## Public SDK (never import `page/`)

Scaffold from
[molvis-plugin-template](https://github.com/MolCrafts/molvis-plugin-template)
(Clack UI). The published command is `npx molvis-plugin create` once that
package is on npm; until then:

```bash
# from a checkout of molvis-plugin-template
node bin/molvis-plugin.mjs create my-plugin
node bin/molvis-plugin.mjs create my-plugin --id com.acme.demo --name "Acme Demo" -y
```

Import from the SDK package:

```ts
import { MolvisPlugin, type PluginAPI, pluginExternals, token } from "@molcrafts/molvis-plugin";
import { Button } from "@molcrafts/molvis-plugin/ui";
import "@molcrafts/molvis-plugin/css";
```

| Path | Contents |
|------|----------|
| `@molcrafts/molvis-plugin` | `MolvisPlugin` base, contract types, tokens, `cn`, `pluginExternals` |
| `@molcrafts/molvis-plugin/ui` | Host-aligned shadcn primitives |
| `@molcrafts/molvis-plugin/css` | shadcn CLI CSS anchor (runtime theme is host-owned) |
| `@molcrafts/molvis-plugin/testing` | `fakePluginAPI`, `mapStorage` for unit tests |

The umbrella re-exports the same values under `@molcrafts/molvis/plugin*`, but
prefer the scoped spelling above: it is the package that is actually
published and injected, and one name per thing is worth more than a synonym.

Implementation may live under monorepo `plugin/` + `page/` (host loader), but
plugin **authors** must not name `page` in import paths. Runtime theme:
host `--molvis-*` tokens (`bg-accent`, `h-control`, `rounded-control`, …).

## Relation to compile-time extension

Fork-time extension still works as in [extending.md](./extending.md). Runtime
plugins wrap the same registries behind a dynamic loader.
