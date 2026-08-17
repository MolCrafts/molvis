/**
 * Sole monorepo import face for `@molcrafts/molrs`.
 *
 * sketch / stage / page must import Frame/Block/generate3D from
 * `@molcrafts/molvis-core/molrs` (or the core barrel), never from
 * `@molcrafts/molrs` directly — so the app bundler keeps a single WASM instance.
 *
 * Marked side-effectful in package.json so WASM init is preserved. Pure data
 * lives in `./elements` and does not import this module.
 */

export * from "@molcrafts/molrs";
