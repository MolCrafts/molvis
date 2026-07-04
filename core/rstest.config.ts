import { defineConfig } from "@rstest/core";

export default defineConfig({
  browser: {
    enabled: true,
    name: "chromium",
    headless: true,
  },
  // Instantiate molrs's (web-target) WASM before every test file. rstest awaits
  // setupFiles ahead of collection, so `new Frame()` in describe() bodies can't
  // race the async instantiation (a bare `import "./setup_wasm"` inside a test
  // file does not get its top-level await honored by the collection shim).
  setupFiles: ["./tests/setup_wasm.ts"],
  include: ["**/?(*.){test,spec}.?(c|m)[jt]s?(x)", "**/test_*.?(c|m)[jt]s?(x)"],
});
