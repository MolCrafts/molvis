import { defineConfig } from "@rstest/core";

/** Unit tests: plain Node, no browser APIs. */
export default defineConfig({
  include: ["tests/**/?(*.){test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**", "**/dist/**"],
});
