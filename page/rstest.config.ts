import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rstest/core";
import { molcraftsUiAlias } from "./molcrafts-ui-alias";

/** Unit tests: plain Node, no browser APIs. */
export default defineConfig({
  plugins: [pluginReact()],
  resolve: {
    alias: molcraftsUiAlias(import.meta.dirname),
  },
  include: ["tests/**/?(*.){test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**", "**/dist/**"],
});
