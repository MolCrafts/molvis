# MolVis agent guide

MolVis is a TypeScript molecular visualization monorepo with peer 3D Stage
and 2D Sketch engines, browser custom elements, a React application, a VS Code
extension, and a Python controller.

## Project skills

Project knowledge lives in standard Agent Skills under `.agents/skills/`.
Read the skill matching the work, then only the references needed for that
task. These files work independently of any particular agent or slash-command
system.

| Work | Skill |
|---|---|
| Package placement, dependencies, public APIs, builds | [molvis-architecture](.agents/skills/molvis-architecture/SKILL.md) |
| Loading, trajectories, workers, coordinates, WASM ownership | [molvis-data-flow](.agents/skills/molvis-data-flow/SKILL.md) |
| Rendering, materials, selection, picking, scene edits | [molvis-rendering](.agents/skills/molvis-rendering/SKILL.md) |
| Application chrome, embedded viewers, Compute forms | [molvis-frontend](.agents/skills/molvis-frontend/SKILL.md) |
| Tests, checks, CI, verification | [molvis-validation](.agents/skills/molvis-validation/SKILL.md) |

## Package map

| Directory | Responsibility |
|---|---|
| `core/` | Sole MolRS/MolWASM gateway; shared framework-free primitives |
| `stage/` | Babylon 3D engine, pipeline, commands, rendering, RPC |
| `sketch/` | React-free 2D molecular editor |
| `stage-viewer/`, `sketch-viewer/` | Custom elements and standalone viewer hosts |
| `plugin/` | Public plugin SDK |
| `src/` | Thin umbrella package exports |
| `page/` | React product application and plugin host |
| `vsc-ext/` | VS Code host and webviews |
| `python/` | Python controller and packaged application bundles |
| `docs/` | Current user and developer documentation |

## Working rules

- Search the owning module, package exports, other workspaces, and declared
  dependencies before adding code. Call a suitable existing implementation
  directly; avoid forwarding wrappers and speculative shared helpers.
- Prefer domain classes with focused methods and direct construction. Keep
  interfaces narrow; callers compose operations. Avoid ambient context bags
  and all-in-one facades.
- Hosts import engine packages through their public exports. Stage and Sketch
  remain peers; only core imports MolRS/MolWASM directly.
- Keep data transforms immutable and commands fully reversible. Explicit
  mutable owners such as edit overlays and handle caches retain their own
  lifecycle contracts.
- Route scene data through the pipeline. Use SceneIndex for canvas identity.
  Retain owning Frames for borrowed WASM Blocks.
- Fix defects in the touched behavior and report material unresolved issues.
  Verify changes with the affected package's isolated tests and relevant checks.
- Use `package.json`, build configs, and CI for executable constraints; do not
  add a repository `scripts/` directory.

Implement authorized work directly. Create a spec only when requested or when
an explicit task requirement calls for a design artifact. Do not generate
migration guides, changelogs, acceptance logs, or task journals by default.
Update current API and usage documentation when behavior changes; keep task
history in git and the conversation. Skills contain reusable instructions and
current contracts, not chronological work records.
