import { defineConfig } from "@rslib/core";

/**
 * `@molcrafts/molvis-sketch-viewer` — `<molvis-sketch>` custom element.
 *
 * Unbundled `./element` for bundlers that already import the sketch engine.
 * Bundled `dist/main.js` for CDN / docs. Page never builds this package.
 *
 * The third lib is the sketch page the Python package serves
 * (`python/src/molvis/sketch_dist`, copied by the root `build:sketch-page`):
 * `python/index.html` plus a self-contained `sketch-page.js` bundle. It goes
 * to `python-dist/`, outside `dist/`, so it is never published to npm and
 * never counted against the CDN budget in `check:pack`.
 */
const watching = process.argv.includes("--watch");

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: !watching,
      source: {
        entry: { element: "./src/element.ts", preview: "./src/preview.ts" },
        tsconfigPath: "./tsconfig.json",
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        externals: [
          "@molcrafts/molvis-sketch",
          "@molcrafts/molvis-core",
          "@molcrafts/molvis-core/molrs",
          "@molcrafts/ui/preview",
          "@molcrafts/ui/styles.css?raw",
        ],
      },
    },
    {
      format: "esm",
      bundle: true,
      autoExternal: false,
      dts: false,
      source: {
        entry: { main: "./src/element_entry.ts" },
        tsconfigPath: "./tsconfig.json",
        // React (the preview header) reads NODE_ENV; a page has no `process`.
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      },
      output: {
        target: "web",
        cleanDistPath: false,
        minify: true,
      },
      tools: {
        rspack(config) {
          config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
          };
          config.output = {
            ...config.output,
            publicPath: "auto",
            filename: (pathData) =>
              pathData.chunk?.name === "main" ? "[name].js" : "1~[name].js",
            chunkFilename: "1~[name].js",
            workerChunkLoading: "import",
          };
          config.optimization = {
            ...config.optimization,
            chunkIds: "named",
          };
        },
      },
    },
    {
      id: "python-page",
      format: "esm",
      bundle: true,
      autoExternal: false,
      dts: false,
      source: {
        entry: { "sketch-page": "./src/python/page_entry.ts" },
        tsconfigPath: "./tsconfig.json",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        minify: true,
        distPath: { root: "python-dist" },
        copy: [{ from: "./python/index.html", to: "index.html" }],
      },
      tools: {
        rspack(config) {
          config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
          };
          config.output = {
            ...config.output,
            publicPath: "auto",
            filename: "[name].js",
            chunkFilename: "1~[name].js",
            workerChunkLoading: "import",
          };
          config.optimization = {
            ...config.optimization,
            chunkIds: "named",
          };
        },
      },
    },
  ],
});
