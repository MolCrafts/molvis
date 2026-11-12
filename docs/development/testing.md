# Testing

One lane per package, unit only. There is no e2e lane, no `integration/`
tree, and no repo-root `regressions/` golden-lock lane.

```bash
npm run build         # build shared artifacts once before checks/tests
npm run typecheck
npm run test:core     npm run test:stage    npm run test:sketch
npm run test:plugin   npm run test:page     npm run test:vsc-ext
npm run test:python
npm run test:js       # core, stage, sketch, plugin, page
npm test              # all of the above
```

## Node only, no browser mode

Every TypeScript suite runs under plain `@rstest/core` in Node: no
`@rstest/browser`, no Playwright, no Chromium, and no jsdom or happy-dom. The
Python suite is plain pytest, and `vsc-ext` is mocha over `tsc` output.

A unit test contains no speed, regression or e2e test. Concretely, a test does
not:

- need a browser API (DOM, custom elements, canvas, OPFS, WASM in a page);
- open a socket, start a server, or talk to a network peer;
- run an external binary (ffmpeg) or a subprocess;
- read a built artifact (`dist/`, `out/`) or assert a bundle size;
- measure time, or depend on an unseeded random source.

The browser-mode suite (core, stage, sketch, both viewers and page) was
retired. The 248 test files that already passed under the Node config without
touching a browser API were kept; the 57 that needed one were deleted, not
shimmed. CI runs Node 22 (`.nvmrc`), which has no `ErrorEvent`: a fake
worker hands its handler a plain `{ message }` object, and a code path that
itself constructs an `ErrorEvent` is not unit-tested. What that leaves uncovered is real: the custom elements
(`stage-viewer`, `sketch-viewer`), the stage GUI (panels, menus, dialogs, app
boot and teardown), the sketch board and composer, OPFS caches, image crop,
and the React components and hooks of `page`. The same cut removed the
Python tests that ran a live molrs `Publisher`, a loopback `websockets`
server, or the ffmpeg binary, and the `vsc-ext` checks on the built `out/`
tree.

If a new test needs a browser, a built artifact, a network peer or a
subprocess, the seam is wrong. Inject a fake; do not add a lane.

## A test must be able to fail

The failure mode worth naming is not the flaky test — it is the test that
reports coverage it cannot possibly provide. Real examples from this tree:

```ts
// Asserted a literal against itself.
const deps = { "@molcrafts/molvis-sketch": "*" };
expect(deps).toEqual({ "@molcrafts/molvis-sketch": "*" });

// The else arm passed unconditionally, so a missing block was accepted.
if (outBonds) { expect(outBonds.nrows()).toBe(0); }
else { expect(true).toBe(true); }

// `MolvisSketch` is a static import; it cannot be undefined.
expect(MolvisSketch).toBeDefined();
```

A subtler one: a unit-system test asserted that switching `real → metal`
re-derives the neighbor skin, but both systems happen to use `2.0`, so the
assertion held whether or not the re-derivation ran. It only bites against
`nano` (`10.0`).

So: **prove the gate bites.** Break the thing on purpose, watch the test go
red, put it back. That applies to type-level gates too — the `satisfies` check
binding the plugin externals list to the host inject map was verified by
deleting a key and confirming `tsc` fails.

Two corollaries:

- Assert per-term, not on a total. A total can be right for the wrong reasons.
- Prefer directory scans over hand-written fixture lists, so a subset
  assertion is not expressible in the first place.

## One module, its own tests

Tests mirror source: `src/foo/bar.ts` → `tests/foo/bar.test.ts`, `FooClass` →
`TestFooClass`. `python/tests/` is flat, matching its flat `src/molvis/`.

A package must go green on **its own** tests, with fakes for outbound
dependencies. If a unit only passes when the full suite runs, when the page
shell boots, or when a sibling package's real implementation is present, that
is a coupling defect — fix the seam, do not add an integration test.

Two consequences that look like inconvenience and are actually the rule
working:

- Plugin tests use `fakePluginAPI` from `@molcrafts/molvis-plugin/testing`.
  It is built from the real `PluginAPI` type, so a new domain becomes a
  compile error in one place instead of silently passing everywhere.
- Duplicate coverage is a bug. When two files test one function, fold the
  weaker into the file that mirrors the module that owns the function.

## CI

The hooks use one cached pre-commit environment from the same molcrafts-ci
revision pinned by `CI_REF`. Their commands live in `package.json`:

- `check:commit`: shared workflow policy, Biome, Python lint, the MolRS gateway
  and version guards, and `uv lock --check`. These read sources without building.
- `check:push`: build all surfaces once, typecheck them, and check package sizes
  and the page public path. This stage does not run unit tests or build docs.

`npm run build:packages` owns one Wireit graph for core, stage, sketch,
plugin and both viewers. The complete `npm run build` reuses that graph,
then builds the page, its Python copy and the VS Code extension. npm release
uploads the exact tarballs from `npm-build`; VSIX packaging uses its existing
`vscode:prepublish` lifecycle to build the extension once.

GitHub owns the complete unit suites and strict docs build. Workflow policy runs
first; expensive jobs wait for it. Fork pushes run policy only, so pushing dev
and master does not compile the same MolPy twice before an upstream PR. Upstream
pull requests and pushes run the suites; a manual dispatch can also run them in
a fork. Shared context still selects Linux for an upstream feature push and all
three operating systems for upstream dev/master, PRs and dispatches.

| job | responsibility |
|---|---|
| `test / context` | shared event, tier and publication decisions |
| `test / workflows` | shared workflow policy on every non-duplicate run |
| `test / javascript` | build package artifacts once; run JS and VS Code unit suites |
| `test / python (<os>)` | build the pinned MolPy binding once per OS, then run pytest; Linux also builds strict docs in that environment |
| `test / result` | require every preceding job to succeed or be intentionally skipped |

The nightly workflow builds one immutable dev snapshot for the page and Python
nightly distribution. Release jobs build and dry-run each surface, then publish
those artifacts only for an upstream `v*` tag. Every shared action and the managed
hook environment use the same immutable CI revision. `setup-source` reuses the
shared `setup-wasm` action for Node, wasm-pack and Binaryen.

## Partners

The Python package and MolWASM are built from the same unified MolPy checkout:
`../molpy/molpy` for Python and `../molpy/molwasm/pkg` for TypeScript.
`.github/partners.env` pins MolCrafts/molpy master at
`70f4c67d83510fd811291013c7e93d454e5cadfc` (0.20.1), and CI fetches that
exact revision through `setup-partners`. mollog and molcfg come from PyPI.
When the sibling checkout changes its package metadata, `uv lock --check`
fails: relock `python/uv.lock` in a commit of its own. Rebuild MolWASM when
changing its Rust source, and validate the intended clean dependency revision.
Install the Rust toolchain named in `../molpy/rust-toolchain.toml`, its
`wasm32-unknown-unknown` target, wasm-pack 0.15.0, and Binaryen (`wasm-opt`),
then run from the MolVis root:

```bash
npm run build:molwasm
npm install
npm run build:packages
npm run typecheck
npm test
```

Rebuild MolWASM after changing the sibling Rust source. The public gateway
remains `@molcrafts/molvis-core/molrs`. `Block.dtype()` now returns concrete
widths (`f64`, `i32`, `u64`), and `Conformer` takes `(addHydrogens?, seed?)`;
the old speed preset is gone. Compute form parameter kinds (`float`, `int`)
are a separate contract and keep their names. UFF now rejects bonds without
an explicit order, so force-field fixtures must declare `bond_type` /
`bond_number` as well as endpoints.

`build:molwasm` uses Cargo's size optimization (`opt-level=z`) and full LTO,
with the source package's existing wasm-opt pass. All default features stay
enabled. Release and nightly builds use `.github/actions/setup-source` to
check out the pinned source, install its Rust and WASM tools, build MolWASM,
and only then install npm dependencies. The 9 MiB Sketch Viewer budget is
checked by `check:pack`, both in the pre-push build gate and npm release job.

The new npm package is not published yet. `check:molrs-release` rejects this
local dependency; switch it to a compatible published version before a release.

If you add a package with a test suite, add it to `test:js` in the same
commit.

## Release

Bump the shared version (`npm run check:versions` must pass), merge to
master, and push a `v*` tag. `release.yml` publishes npm (trusted
publishing, environment `npm`), PyPI (environment `pypi`) and the VS Code
extension (environment `vscode-marketplace`, secrets `VSCE_PAT` and
`OVSX_PAT`). The npm and PyPI trusted publishers must name `release.yml`.
`nightly.yml` publishes `molcrafts-molvis-nightly` from the `pypi-nightly`
environment.
