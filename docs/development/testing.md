# Testing

Use the owning package's unit tests for each change. Tests mirror source:
`src/foo/bar.ts` maps to `tests/foo/bar.test.ts`. Keep outbound dependencies
behind narrow interfaces and inject fakes so a package can pass independently.

Build shared artifacts when required by package imports, then run the relevant
commands from the repository root:

```bash
npm run build
npm run typecheck
npm run test:core
npm run test:stage
npm run test:sketch
npm run test:sketch-viewer
npm run test:plugin
npm run test:page
npm run test:vsc-ext
npm run test:python
npm run test:js       # core, stage, sketch, sketch-viewer, plugin, page
npm test              # JavaScript, Python, and VS Code suites
```

## Node only, no browser mode

TypeScript unit suites use `@rstest/core` in plain Node, except the VS Code
suite, which uses mocha over TypeScript output. Python uses pytest. Follow
`.nvmrc` for the supported Node version.

A unit test does not require DOM/custom elements, canvas, OPFS, a browser,
a network peer, a server, a subprocess, or an external binary. Do not add DOM
shims, browser mode, e2e/integration directories, performance thresholds,
golden locks, or source-text assertions. Inject a fake at the dependency seam.
Tests do not read built artifacts or assert package size; packaging checks own
those concerns.

Custom-element lifecycle, GUI layout, WebGL appearance, and browser storage
need manual inspection when changed. Report those checks separately: Node
unit tests cannot prove browser behavior or visual quality.

## A test must be able to fail

Assert observable behavior, including invalid inputs and failure paths. Avoid
comparing literals to themselves, testing that a static import exists, or
letting an assertion disappear behind an unconditional success branch.

Choose inputs that distinguish the intended outcomes. Verify that the test or
contract guard fails when the defect is present, including type-level guards.
Assert individual terms when an aggregate could hide an error. Keep randomness
seeded and results independent of timing.

## One module, its own tests

Keep a module's coverage in its mirrored test file rather than duplicating it
across directories. Small local helpers can remain local. Reuse existing
fixtures and WASM setup when their contracts fit.

Plugin tests use `fakePluginAPI` from `@molcrafts/molvis-plugin/testing`, which
is checked against the public API type. A test must not depend on full app
startup, a sibling package's concrete implementation, or another test's state.

Add a new package suite to the appropriate root test command in the same
change. The Python/TypeScript catalog seam is covered by
`python/tests/test_wire_parity.py`; keep that contract in one place.

## CI

`package.json` owns the local gates:

- `npm run check:commit`: workflow policy, Biome, Python lint, MolRS gateway,
  synchronized versions, and `uv lock --check`. It reads sources without a build.
- `npm run check:push`: one full build, all typechecks, package budgets, and the
  page public-path guard. It does not run unit tests or build documentation.

`build:packages` owns the Wireit graph for core, Stage, Sketch, plugins, and
both viewers. `build` reuses that graph and builds the page, Python bundles,
and extension. Keep dependency ordering in this graph.

GitHub runs complete unit suites and strict documentation after workflow
policy passes. Fork pushes run policy only; upstream pushes, pull requests,
and eligible manual dispatches run the configured suites. The workflow context
selects operating systems and publication eligibility. Read `.github/workflows/`
and the pinned `CI_REF` for the current job definitions.

For documentation changes, run:

```bash
MOLVIS_SKIP_UI_BUILD=1 uv run --project python --extra docs zensical build --strict
```

## Partners

Python and MolWASM use the same unified MolPy checkout: `../molpy/molpy` for
Python and `../molpy/molwasm/pkg` for TypeScript. `.github/partners.env` pins
the CI revision. Validate against the intended revision and keep
`python/uv.lock` consistent with dependency metadata.

After changing sibling Rust source, install its pinned Rust toolchain,
`wasm32-unknown-unknown` target, wasm-pack, and Binaryen, then rebuild:

```bash
npm run build:molwasm
npm install
npm run build:packages
npm run typecheck
npm test
```

Only core imports MolRS/MolWASM directly; other packages use
`@molcrafts/molvis-core/molrs`. Use concrete column types from that gateway.
Domain IDs use `BigUint64Array`; GPU/display indices use `Uint32Array`. Force
field fixtures must provide explicit bond order as well as endpoints.

## Release

Keep the shared version synchronized (`npm run check:versions`). Release
workflows build and dry-run their artifacts before publishing an upstream
`v*` tag. npm publishes the checked tarballs; VSIX packaging uses the existing
`vscode:prepublish` lifecycle. `check:molrs-release` rejects development/local
MolWASM dependencies, which must be replaced with a compatible published
version before release. Read `release.yml` and `nightly.yml` for publication
configuration rather than duplicating it in test scripts.
