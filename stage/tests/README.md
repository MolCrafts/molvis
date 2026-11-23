# Stage unit tests

Follow [AGENTS.md](../../AGENTS.md) and the current
[testing guide](../../docs/development/testing.md).

Tests mirror their owning source module: `src/foo/bar.ts` maps to
`tests/foo/bar.test.ts`. Keep one module's coverage in its mirrored test file
and use fakes for outbound dependencies. Do not boot a full `MolvisApp` or add
an integration, browser, e2e, performance, or golden-lock test lane.

Run from the repository root:

```bash
npm run test:stage
```

The runner is `@rstest/core` in plain Node. `setup_wasm.ts` provides the existing
MolRS setup; reuse `workload_test_helpers.ts` and `fixtures/` where their
contracts fit. Browser appearance is checked manually, separately from units.
