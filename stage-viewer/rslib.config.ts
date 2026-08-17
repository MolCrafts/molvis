import { defineConfig } from "@rslib/core";
import { rspack } from "@rspack/core";

/**
 * `@molcrafts/molvis-stage-viewer` — custom elements, not the 3D engine.
 *
 * Two outputs, one package:
 *   1. Unbundled `./element` for bundlers that already import the engine.
 *   2. Bundled `dist/main.js` CDN that registers the tags (script tag / docs).
 *
 * Page / plugin / vsc-ext never build this package. The engine stays in
 * `@molcrafts/molvis-stage`. molrs is reached only via that engine.
 */
const ENGINE_EXTERNALS = [
  "@babylonjs/core",
  "@babylonjs/gui",
  "@babylonjs/materials",
  "@molcrafts/molvis-stage",
  "@molcrafts/molvis-stage/io",
  "@molcrafts/molvis-core",
  "@molcrafts/molvis-core/molrs",
] as const;

const BABYLON_BANNED = [
  "@babylonjs/inspector",
  "@babylonjs/gui-editor",
  "@babylonjs/loaders",
] as const;

const watching = process.argv.includes("--watch");

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: !watching,
      source: {
        entry: {
          element: "./src/element.ts",
          gallery_camera: "./src/gallery_camera.ts",
          web_component_runtime: "./src/web_component_runtime.ts",
        },
        tsconfigPath: "./tsconfig.json",
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        externals: [...ENGINE_EXTERNALS, ...BABYLON_BANNED],
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
            splitChunks: {
              chunks: "all",
              cacheGroups: {
                molrs: {
                  test: /[\\/]node_modules[\\/]@molcrafts[\\/]molrs[\\/]/,
                  name: "lib-molrs",
                  priority: 30,
                  enforce: true,
                },
                babylonjs: {
                  test: /[\\/]node_modules[\\/]@babylonjs[\\/](?!serializers)/,
                  name: "lib-babylonjs",
                  priority: 20,
                  enforce: true,
                },
              },
            },
          };
          const ban = BABYLON_BANNED.map((name) =>
            name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ).join("|");
          const unusedMaterials =
            /[\\/]@babylonjs[\\/]core[\\/](?:Shaders|Materials|Meshes)[\\/](?:water|lava|fur|sky|terrain|triPlanar|cell|fire|fluent|gaussianSplatting|mixMaterial|gradient)/i;
          config.plugins = [
            ...(config.plugins ?? []),
            new rspack.IgnorePlugin({
              resourceRegExp: new RegExp(ban),
            }),
            new rspack.IgnorePlugin({
              resourceRegExp: unusedMaterials,
            }),
          ];
        },
      },
    },
  ],
});
