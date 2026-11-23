---
name: molvis-validation
description: Select and run MolVis package tests, static checks, typechecks, packaging checks, and documentation validation. Use when verifying a change, adding or fixing tests, or changing CI and build gates.
---

# MolVis validation

Read [Testing](../../../docs/development/testing.md) for the current commands
and test boundaries. `package.json` and workflow files own executable checks.

1. Choose checks from the changed behavior. Run the owning package's tests
   with fakes for outbound dependencies, then relevant typechecks/static gates.
   Tests mirror the source module; avoid duplicate cases in another directory.
2. TypeScript unit suites use plain Node. Do not introduce browser-mode tests,
   DOM shims, e2e/integration directories, network peers, external processes,
   performance thresholds, or golden/source-text locks.
3. Assert observable behavior that can fail for the reported defect. Avoid
   literal self-comparisons, import-exists checks, skipped assertions, and tests
   that simply restate implementation details. For contract guards, verify
   that an invalid input actually fails.
4. Reuse `@molcrafts/molvis-plugin/testing`'s `fakePluginAPI` for plugin tests
   and the existing WASM setup for core/Stage tests. Keep tiny local test helpers
   local; do not introduce a general test-utils framework for them.
5. Use `npm run check:commit` for source-only policy, lint, and dependency
   guards. Use `npm run check:push` when build, types, published exports,
   packaging, or host integration need verification.
6. For documentation, run the existing strict Zensical build. For visual/GPU
   behavior, inspect the affected view manually; plain Node tests do not prove
   appearance. Report that verification accurately without adding a browser
   test lane.
7. After relevant checks pass, stop repeating them unless another edit or
   unresolved failure justifies it. Summarize behavior, checks, and material
   limitations in the reply; do not create acceptance logs or task journals.
