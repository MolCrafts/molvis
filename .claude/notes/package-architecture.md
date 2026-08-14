# Package architecture

Canonical monorepo layout for MolVis **0.2.0**.

## Topology

```
core/     @molcrafts/molvis-core     shared molrs gateway + pure/browser primitives
  │                                  (published; transitive only — not a product install)
  ├─→ stage/   @molcrafts/molvis-stage    3D engine (Babylon, pipeline, RPC)
  └─→ sketch/  @molcrafts/molvis-sketch   2D canvas sketcher
        │
        ▼
  plugin/     @molcrafts/molvis-plugin    plugin authoring SDK (base class, contract, UI)
        │
        ▼
  repo root   @molcrafts/molvis      thin re-exports — ./plugin, ./stage, ./sketch
        │
        ▼
  page/       (private)              React 19 product shell + plugin *host* loader
  vsc-ext/    molvis (private)       VS Code extension host
  python/     molcrafts-molvis       PyPI driver + shipped page bundle
```

Plugin authors import **`@molcrafts/molvis/plugin`** only — never `page/…`.

## Rules

1. **Only `core` imports `@molcrafts/molrs`.** stage/sketch import `@molcrafts/molvis-core` (and subpaths).
2. **sketch ↛ stage, stage ↛ sketch.** Peers only.
3. **React only in `page` (and hosts that mount page).** Engines are React-free.
4. **Hosts consume engines as packages**, not monorepo source paths:
   - Import `@molcrafts/molvis-stage` / `@molcrafts/molvis-sketch` / `@molcrafts/molvis-core/*`
   - Resolve via workspace `node_modules` → package `exports` → `dist/`
   - **Never** `../stage/src/...` or `../core/src/...` from hosts
5. **Umbrella is the repo root** (`@molcrafts/molvis`), not a separate workspace package.
6. **Build order for hosts:** `core → stage → sketch → page | vsc-ext`.
7. **Dev watch order is wireit's job, not a script's.** `npm run dev:page` is
   `npm run dev -w page`; wireit reads each package's own `dependencies` and
   starts core → stage/sketch → host in order. Never preface it with a
   one-shot `build:engines` (that was a race bandage and printed misleading
   “build” noise). Library `dev` is `rslib build --watch` (rslib’s
   compile-to-dist verb); watch mode sets `cleanDistPath: false` so dist is
   never wiped mid-rebuild while dependents resolve exports.
8. **No `scripts/` directory.** Repo constraints live where they run:
   `package.json` one-liners (`check:versions`, `check:molrs-gateway`,
   `check:pack`), wired into `.github/workflows/ci.yml` **and**
   `.pre-commit-config.yaml`. Build steps belong to the build config; release
   packaging belongs to the release workflow. A rule in a loose script is a
   rule with no owner, no test, and no gate.

## Publish surface

| Package | How published |
|---------|----------------|
| `@molcrafts/molvis-core` | npm (tag workflow) |
| `@molcrafts/molvis-stage` | npm |
| `@molcrafts/molvis-sketch` | npm |
| `@molcrafts/molvis-plugin` | npm (plugin SDK) |
| `@molcrafts/molvis` | npm (root — re-exports `./plugin`, engines) |
| `molvis-plugin` | npm CLI — `npx molvis-plugin create` (template repo) |
| `molcrafts-molvis` | PyPI |
| VS Code `molvis` | Marketplace (vsce) |

## Not in tree

- No `umbrella/` workspace
- No repo-root `e2e/` and no engine `examples/` demos
- No host path aliases into engine `src/`

## regressions/ (sanctioned 2026-08-14, supersedes the 2026-08-05 removal)

Repo-root `regressions/` is the public-API golden-lock lane — one plain-node
assertion script per shipped spec. Contract: import built `dist` output only
(public barrel or deep path), hard-coded goldens with a provenance comment, no
WASM instantiation, no third-party runtime, runs via `node regressions/<slug>.ts`
and prints `<slug> ok` on exit 0. Precedent: the v0.2.0 theme chain
(`theme-tab10-ovito-01..07`). This is **not** an e2e lane — no browser, no
engine boot, no interaction — so the no-e2e iron law is untouched.
