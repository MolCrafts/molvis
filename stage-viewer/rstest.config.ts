import { defineConfig } from "@rstest/core";

/** Browser unit tests for the custom-element wrappers. */
export default defineConfig({
  browser: {
    enabled: true,
    name: "chromium",
    headless: true,
    provider: "playwright",
  },
  include: ["tests/**/?(*.){test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**", "**/dist/**"],
});
