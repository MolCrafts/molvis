import { defineConfig } from "@rslib/core";

/**
 * `@molcrafts/molvis-sketch-viewer` — `<molvis-sketch>` custom element.
 *
 * Unbundled `./element` for bundlers that already import the sketch engine.
 * Bundled `dist/main.js` for CDN / docs. Page never builds this package.
 */
const watching = process.argv.includes("--watch");

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: !watching,
      source: {
        entry: { element: "./src/element.ts" },
        tsconfigPath: "./tsconfig.json",
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        externals: [
          "@molcrafts/molvis-sketch",
          "@molcrafts/molvis-core",
          "@molcrafts/molvis-core/molrs",
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
      },
      output: {
        target: "web",
        cleanDistPath: false,
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
  ],
});
