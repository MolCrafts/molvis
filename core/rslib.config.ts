import { defineConfig } from "@rslib/core";
import { rspack } from "@rspack/core";

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
 *
 * Inspector / gui-editor are banned from the product: they are multi-MB debug
 * UIs molvis never ships. The unbundled library build externals them (so a
 * stray import fails at package-resolution time), and the CDN `elements`
 * bundle IgnorePlugin-strips them so a stale dynamic import cannot reintroduce
 * the weight as async chunks.
 */
const BABYLON_RUNTIME_EXTERNALS = [
  "@babylonjs/core",
  "@babylonjs/gui",
  "@babylonjs/materials",
  "@molcrafts/molrs",
  "tslog",
] as const;

/** Debug-only Babylon packages that must never land in molvis-core dist. */
const BABYLON_BANNED = [
  "@babylonjs/inspector",
  "@babylonjs/gui-editor",
  // loaders are only pulled by inspector / editor tooling, not by molvis
  // render path. glTF *export* uses @babylonjs/serializers (kept).
  "@babylonjs/loaders",
] as const;

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
        externals: [...BABYLON_RUNTIME_EXTERNALS, ...BABYLON_BANNED],
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
          // Belt-and-suspenders: even a residual `import("@babylonjs/inspector")`
          // must not emit multi-MB async chunks into dist/.
          const ban = BABYLON_BANNED.map((name) =>
            name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ).join("|");
          config.plugins = [
            ...(config.plugins ?? []),
            new rspack.IgnorePlugin({
              resourceRegExp: new RegExp(ban),
            }),
          ];
        },
      },
    },
  ],
});
