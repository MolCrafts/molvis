import { defineConfig } from "@rstest/core";

export default defineConfig({
  browser: {
    enabled: true,
    name: "chromium",
    headless: true,
  },
  // Import bundler-target @molcrafts/molrs before every test file so its WASM
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
  include: ["**/?(*.){test,spec}.?(c|m)[jt]s?(x)", "**/test_*.?(c|m)[jt]s?(x)"],
});
