# Testing

One lane per package, unit only. There is no e2e lane in this repo and no
`integration/` tree. Repo-root `regressions/` holds plain-node golden-lock
scripts (one per shipped spec, dist imports only, hard-coded goldens, no WASM
init) — it is an assertion lane, not e2e.

```bash
npm run test:core     npm run test:stage    npm run test:sketch
npm run test:page     npm run test:vsc-ext  npm run test:python
npm test              # all of the above
```

## Browser mode is not e2e

`core`, `stage`, `sketch` and `page` run under `@rstest/core` in **browser
mode** — `@rstest/browser` plus a headless Playwright Chromium. That is there
because WASM, OPFS, canvas and DOM APIs have no faithful Node stand-in, not
because anything is being driven end to end.

The distinction matters when you are deciding what to delete:

| | Browser-mode unit test | E2E |
|---|---|---|
| What runs | your test body, inside the page bundle | a built app, from outside |
| Talks to | the module under test | a URL, a server, a real extension host |
| Fails because | that module is wrong | anything in the stack is wrong |

Playwright appearing in `devDependencies` is therefore not evidence of an e2e
lane. Removing it would delete roughly 1,100 unit tests.

The two suites that historically wanted to be e2e were retired rather than
kept:

- **`vsc-ext`** used to download VS Code 1.120.0 and boot a real extension
  host. Five of its seven tests only read `package.json` `contributes`; those
  are now `tests/unit/extension/manifest.test.ts` and run in milliseconds. The
  two that genuinely needed a host went, along with the
  `molvis._test.getRegisteredPanelViewTypes` command that existed to serve
  them — production code should not carry a test-only surface.
- **`python`** had a `tests/integration/` tree behind a pytest marker. Both
  files are in-process (a loopback `websockets` client, and the ffmpeg binary
  vendored by `imageio-ffmpeg`), so they are ordinary unit tests of
  `transport/websocket.py` and `video.py` and now live beside the rest.

If a new test needs a browser driver, a built artifact, or a network peer, the
seam is wrong. Inject a fake; do not add a lane.

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
- Duplicate coverage is a bug. `fingerprintFile` had two test files; the
  weaker one was folded into `opfs.test.ts`, which mirrors the module that
  actually owns the function.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, a `guards` job
(`check:molrs-gateway` — only `core/` may import `@molcrafts/molrs`), the four
browser-mode suites as a matrix, `test-vsc-ext`, `test-python`, and the
builds.

The test matrix is worth a note: CI used to run `test:core` alone, so stage's
881 tests — the largest suite in the repo — were never executed remotely.
If you add a package, add it to the matrix in the same commit.
