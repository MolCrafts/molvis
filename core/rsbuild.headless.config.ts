import { defineConfig } from "@rsbuild/core";

/**
 * Build the headless render harness (`examples/headless_render.ts`) into a
 * self-contained static bundle that a Playwright driver loads in headless
 * Chromium. Output lands in `examples-dist/headless/`.
 */
export default defineConfig({
  html: {
    title: "molvis headless render",
    template: "./examples/headless.html",
  },
  source: {
    entry: {
      index: "./examples/headless_render.ts",
    },
    define: {
      __WASM_INLINE__: JSON.stringify(false),
    },
  },
  output: {
    distPath: {
      root: "examples-dist/headless",
    },
  },
});
