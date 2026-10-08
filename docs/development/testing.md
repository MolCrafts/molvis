# Testing

One lane per package, unit only. There is no e2e lane, no `integration/`
tree, and no repo-root `regressions/` golden-lock lane.

```bash
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

Every workflow starts with a `<file> / context` job running
`MolCrafts/molcrafts-ci/actions/ci-context@master`, which decides the tier,
upstream-only gating and pull-request dedup for all MolCrafts repositories;
the other jobs read its outputs. The fast tier runs on a feature-branch push to
MolCrafts; the full tier on every push to a fork (so a branch is proven before
its pull request), on dev, master and main on MolCrafts, and on pull requests,
tags and dispatches.

| workflow | fast tier | full tier | upstream only |
|---|---|---|---|
| `lint.yml` | `lint / biome`, `lint / guards` (`check:molrs-gateway`, `check:versions`, `uv lock --check`), `lint / typecheck`, `lint / workflows` (`actions/check-workflows`) | same | — |
| `test.yml` | `test / context`, `test / js` (`npm run test:js`), `test / vsc-ext`, `test / python (ubuntu-latest)` | + `test / build` (stage, viewers + `check:pack`, page + `check:page-public-path`, vsc-ext), `test / python (macos-latest)`, `test / python (windows-latest)` | — |
| `docs.yml` | `docs / build` (strict Zensical) | same | — |
| `nightly.yml` | — | — | daily when dev moved: `nightly / page` (app.molcrafts.org/nightly/molvis/), `nightly / python` (PyPI `molcrafts-molvis-nightly`) |
| `release.yml` | — | — | `release / {npm,python,vsc-ext}-build` build and dry-run; on a `v*` tag pushed to MolCrafts (`publish`), `release / npm`, `release / python`, `release / vsc-ext` upload; `workflow_dispatch` is a dry run anywhere |

A pull request inside a fork runs only the context jobs: its push already ran
the full tier. Shared setup is
`MolCrafts/molcrafts-ci/actions/setup-{node,python}@master`.

## Partners

The Python package is built and tested against its partners' `dev`, not their
releases. `.github/partners.env` names them (molrs and molpy), and
`python/pyproject.toml` builds `molcrafts-molrs` and `molcrafts-molpy` from the
sibling checkouts `../molrs` and `../molpy` (`[tool.uv.sources]`); molpy's own
sources add `../mollog` and `../molcfg` (their `master`). CI checks them out
there with `MolCrafts/molcrafts-ci/actions/setup-partners@master` in
`lint / guards`, `test / python` and `docs / build`; locally, keep the four
repositories next to this one. When a partner's `dev` changes its package
metadata, `uv lock --check` fails: relock `python/uv.lock` in a commit of its
own.

The TypeScript packages build against the published `@molcrafts/molrs`
(`core/package.json`).
`.pre-commit-config.yaml` mirrors these jobs; when you add or
change one, change the hook in the same commit.

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
