import { defineConfig } from "@rstest/core";

/** Browser unit tests: SketchComposer needs canvas + WASM. */
export default defineConfig({
  browser: {
    enabled: true,
    name: "chromium",
    headless: true,
    provider: "playwright",
  },
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
