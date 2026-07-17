import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  html: {
    title: "molvis dev",
    meta: {
      charset: {
        charset: "UTF-8",
      },
      viewport: "width=device-width, initial-scale=1.0",
    },
    template: "./examples/index.html",
  },
  source: {
    entry: {
      index: "./examples/demo_empty.ts",
    },
  },
  tools: {
    rspack(config) {
      // molrs is wasm-bindgen bundler-target only.
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
    },
  },
});
