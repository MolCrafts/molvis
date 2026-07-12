import { defineConfig } from "@rslib/core";

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      source: {
        entry: { index: "./src/**" },
        define: {
          __WASM_INLINE__: JSON.stringify(false),
        },
      },
      output: {
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
        define: {
          __WASM_INLINE__: JSON.stringify(false),
        },
      },
      output: {
        target: "web",
      },
    },
  ],
});
