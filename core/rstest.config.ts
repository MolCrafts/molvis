import { defineConfig } from "@rstest/core";

/** test:core runs in Node. Playwright stays on the other workspace suites. */
export default defineConfig({
  pool: { maxWorkers: 4 },
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
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    // These need a document (canvas / custom elements). They are the
    // Playwright cases; test:core does not launch a browser.
    "tests/element_picker.test.ts",
    "tests/image_crop.test.ts",
  ],
});
