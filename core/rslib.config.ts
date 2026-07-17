import { defineConfig } from "@rslib/core";

/**
 * Library build for `@molcrafts/molvis-core`.
 *
 * `@molcrafts/molrs` is wasm-bindgen **bundler-target only** (auto-inits on
 * import via `import * as wasm from "./molrs_bg.wasm"` + `__wbg_set_wasm`).
 * Never add a web-target `init()` / `await init()` path.
 *
 * The bundled `elements` entry must enable `asyncWebAssembly` so rspack wires
 * the `.wasm` module the same way rsbuild app / vsc-ext builds do. Without it,
 * glue ships with an uninitialized `let wasm` and `new Frame()` throws
 * `Cannot read properties of undefined (reading 'frame_new')`.
 */
export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      source: {
        entry: { index: "./src/**" },
      },
      output: {
        // rsbuild "web" = browser runtime environment, NOT wasm-pack --target web
        target: "web",
        externals: [
          "@babylonjs/core",
          "@babylonjs/gui",
          "@babylonjs/inspector",
          "@babylonjs/materials",
          "@molcrafts/molrs",
          "tslog",
        ],
      },
    },
    {
      format: "esm",
      bundle: true,
      autoExternal: false,
      dts: false,
      source: {
        entry: { elements: "./src/element_entry.ts" },
      },
      output: {
        target: "web",
      },
      tools: {
        rspack(config) {
          config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
          };
          // Resolve wasm / chunk URLs relative to the elements entry URL so the
          // same bundle works under docs (`…/assets/molvis-core/`), CDN, or any
          // host path without a hard-coded absolute publicPath.
          config.output = {
            ...config.output,
            publicPath: "auto",
          };
        },
      },
    },
  ],
});
