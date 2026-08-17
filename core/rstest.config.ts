import { defineConfig } from "@rstest/core";

/** Unit tests: browser mode for OPFS / WASM. */
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
