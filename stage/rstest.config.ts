import { defineConfig } from "@rstest/core";

/** Unit tests: browser mode (@rstest/browser + Playwright Chromium) for WASM/DOM. */
export default defineConfig({
  browser: {
    enabled: true,
    name: "chromium",
    headless: true,
    // Explicit Playwright provider (default); peer `playwright` must be installed.
    provider: "playwright",
  },
  // Import bundler-target @molcrafts/molvis-core/molrs before every test file so its WASM
  // side-effect (import .wasm + __wbindgen_start) runs before collection.
  // rstest awaits setupFiles; a bare import inside a test file does not get
  // top-level await honored by the collection shim.
  // Never add a wasm-bindgen web-target init() path — molrs is bundler-only.
  setupFiles: ["./tests/setup_wasm.ts"],
  tools: {
    rspack(config) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
    },
  },
  include: ["tests/**/?(*.){test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**", "**/dist/**"],
});
