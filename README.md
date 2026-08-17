<div align="center">

<h1>
  <img src=".github/assets/molvis-logo.svg" alt="MolVis logo" height="48" align="absmiddle">
  &nbsp;MolVis
</h1>

<p><strong>A visual workspace where people and agents inspect molecular data together</strong></p>

<p>
  <a href="https://github.com/molcrafts/molvis/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/MolCrafts/molvis/ci.yml?style=flat-square&logo=githubactions&logoColor=white&label=CI" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@molcrafts/molvis-stage"><img src="https://img.shields.io/npm/v/@molcrafts/molvis-stage?style=flat-square&logo=npm&logoColor=white" alt="npm stage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BSD--3--Clause-18432B?style=flat-square" alt="License"></a>
</p>

<p>
  <a href="https://docs.molcrafts.org/molvis/"><b>Documentation</b></a> &nbsp;&middot;&nbsp;
  <a href="#quick-start"><b>Quick start</b></a> &nbsp;&middot;&nbsp;
  <a href="#molcrafts-ecosystem"><b>Ecosystem</b></a>
</p>

</div>

MolVis renders molecules, simulation boxes, and trajectories in the browser, with
one product surface shared across the web, VS Code, and Jupyter. Its bidirectional
RPC layer lets an agent operate the live scene while the user inspects every
result, selects the relevant atoms or bonds, and sends that precise visual context
back to the agent.

## Vision

Molecular visualization tools have long made you choose: a powerful desktop application that is hard to install and impossible to share, or a lightweight web viewer that cannot keep up once your work gets serious. MolVis exists to erase that trade-off — a single rendering stack that runs anywhere a browser does, with no compromise on what you can see or do.

We want looking at a structure to be frictionless. Drag a file onto a page, open it in your editor next to its input deck, or display it inline in a notebook cell — the viewport, the modes, and the shortcuts are identical everywhere, so the muscle memory you build transfers across every context you work in.

And we want visualization to be more than a picture. MolVis treats editing, measurement, pipeline transforms, and analysis as first-class, fully reversible operations on live molecular data — so the viewer becomes a place where you actually do the work, not just admire the result.

## Human-in-the-loop agent workflow

MolVis is designed to be the visual boundary between an agent and molecular
data:

1. An agent uses JSON-RPC commands to load data, move the camera, change the
   representation, select atoms, edit the scene, or run pipeline operations.
2. The user reviews the exact result in the shared viewer instead of auditing a
   textual description of it.
3. The user selects atoms or bonds that need attention. MolVis emits the
   selection, active frame, and interaction state back to the host.
4. The agent receives a structured subset with `get_selected()`, acts on the
   feedback, and presents the next visible result.

RPC requests and responses are structured and snapshots can capture the visible
state, making the workflow straightforward for an agent host to record and
audit. MolVis provides the observable interaction boundary; durable audit-log
storage remains the responsibility of the host application.

See [Agent workflows](https://docs.molcrafts.org/molvis/interfaces/python/agents/)
for a complete selection-feedback loop.

## Packages

| Package | Role |
|---------|------|
| `@molcrafts/molvis-stage` | **3D stage** — Babylon.js rendering, commands, modes, pipeline, RPC |
| `@molcrafts/molvis-sketch` | **2D sketch** — Canvas structure editor |
| `@molcrafts/molvis` | **Umbrella** (repo root) — re-exports stage + sketch + plugin SDK |
| `@molcrafts/molvis-plugin` | Plugin authoring SDK (base class, contract, host-aligned UI) |
| `@molcrafts/molvis-core` | Shared molrs gateway + element catalog (transitive; not a product install) |
| `page` | React 19 product UI (ships inside Python / VS Code hosts) |
| VS Code extension | Custom editor for molecular formats |
| `molcrafts-molvis` (PyPI) | Python driver over WebSocket |

## Install

```bash
# both engines (root package)
npm install @molcrafts/molvis

# 3D only
npm install @molcrafts/molvis-stage

# 2D only
npm install @molcrafts/molvis-sketch
```

Requires Node.js 22+. The Python package (`pip install molcrafts-molvis`) needs Python 3.12+; the VS Code extension installs from the Marketplace.

## Quick start

```typescript
import { mountMolvis } from "@molcrafts/molvis-stage";
import { loadFileContent } from "@molcrafts/molvis-stage/io";

const container = document.getElementById("viewer");
if (!container) throw new Error("viewer container not found");

const app = mountMolvis(container);
await app.start();

const pdbText = await (await fetch("/structure.pdb")).text();
await loadFileContent(app, pdbText, "structure.pdb");
```

See the [documentation](https://docs.molcrafts.org/molvis/) for the web viewer, the VSCode extension, the Python API, and how to extend the engine.

## Documentation

- [Tutorial](https://docs.molcrafts.org/molvis/tutorial/) — frames, camera, representations, selection, pipeline, trajectories, export
- [Agent workflows](https://docs.molcrafts.org/molvis/interfaces/python/agents/) — RPC control, visual review, selection feedback, and audit records
- [Interfaces](https://docs.molcrafts.org/molvis/interfaces/web/) — Web/TypeScript, Python/Jupyter, and VS Code guides
- [Development](https://docs.molcrafts.org/molvis/development/) — embed MolVis and write custom modifiers and commands
- [API Reference](https://docs.molcrafts.org/molvis/api/typescript/) — TypeScript library and Python package

## MolCrafts ecosystem

| Project | Role |
|---------|------|
| [molpy](https://github.com/MolCrafts/molpy)     | Python toolkit — shared molecular data model & workflow layer |
| [molrs](https://github.com/MolCrafts/molrs)     | Rust core — molecular data structures & compute kernels (native + WASM) |
| [molpack](https://github.com/MolCrafts/molpack) | Packmol-grade molecular packing (Rust + Python) |
| **molvis** — this repo | WebGL molecular visualization & editing |
| [molexp](https://github.com/MolCrafts/molexp)   | Workflow & experiment-management platform |
| [molnex](https://github.com/MolCrafts/molnex)   | Molecular machine-learning framework |
| [molq](https://github.com/MolCrafts/molq)       | Unified job queue — local / SLURM / PBS / LSF |
| [molcfg](https://github.com/MolCrafts/molcfg)   | Layered configuration library |
| [mollog](https://github.com/MolCrafts/mollog)   | Structured logging, stdlib-compatible |
| [molhub](https://github.com/MolCrafts/molhub)   | Molecular dataset hub |
| [molmcp](https://github.com/MolCrafts/molmcp)   | MCP server for the ecosystem |
| [molrec](https://github.com/MolCrafts/molrec)   | Atomistic record specification |

## Contributing

Contributions are welcome — see the [development guide](https://docs.molcrafts.org/molvis/development/).

## License

BSD-3-Clause — see [LICENSE](LICENSE).

<hr>

<div align="center">
<sub>Crafted with 💚 by <a href="https://github.com/MolCrafts">MolCrafts</a></sub>
</div>
