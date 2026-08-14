import { defineConfig } from "@rslib/core";
import { rspack } from "@rspack/core";

/**
 * Library build for `@molcrafts/molvis-stage` (3D engine).
 *
 * molrs is reached only via `@molcrafts/molvis-core` (workspace private).
 * Never import `@molcrafts/molrs` here.
 *
 * The bundled `viewer` CDN entry must enable `asyncWebAssembly` so rspack
 * wires the `.wasm` module.
 */
const RUNTIME_EXTERNALS = [
  "@babylonjs/core",
  "@babylonjs/gui",
  "@babylonjs/materials",
  "@molcrafts/molvis-core",
  "@molcrafts/molvis-core/molrs",
  "@molcrafts/molvis-core/elements",
  "@molcrafts/molvis-core/element-picker",
  "@molcrafts/molvis-core/opfs",
  "@molcrafts/molvis-core/platform",
  "@molcrafts/molvis-core/save-file",
  "@molcrafts/molvis-core/image-crop",
  "@molcrafts/molvis-core/workload",
] as const;

/** Debug-only Babylon packages that must never land in stage dist. */
const BABYLON_BANNED = [
  "@babylonjs/inspector",
  "@babylonjs/gui-editor",
  "@babylonjs/loaders",
] as const;

/** Watch must not wipe dist — page/hosts resolve exports→dist concurrently. */
const watching = process.argv.includes("--watch");

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      // Keep package-name imports in .d.ts (consumers resolve @molcrafts/molvis-core
      // from the registry/workspace). Never rewrite to monorepo-relative paths.
      // Watch mode skips declaration generation: it is ~16 of the 21 seconds a
      // dev start costs, and `rsbuild dev` type-strips rather than reading
      // .d.ts. `build` and `typecheck` still emit and check them, and the
      // previous build's files stay on disk for the editor (watch does not
      // clean dist — see cleanDistPath above).
      dts: !watching,
      source: {
        entry: { index: "./src/**" },
        tsconfigPath: "./tsconfig.build.json",
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
        externals: [...RUNTIME_EXTERNALS, ...BABYLON_BANNED],
      },
    },
    {
      format: "esm",
      bundle: true,
      autoExternal: false,
      dts: false,
      source: {
        entry: { viewer: "./src/element_entry.ts" },
        tsconfigPath: "./tsconfig.build.json",
      },
      output: {
        target: "web",
        cleanDistPath: !watching,
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
            // The bundled viewer folds the module workers (compute /
            // trajectory spawn); their chunks must load via native
            // `import()`, never legacy `importScripts`.
            workerChunkLoading: "import",
          };
          config.optimization = {
            ...config.optimization,
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
          // Decorative Babylon materials / shaders MolVis never constructs.
          // Leaving them in the graph emits 1~water/lava/fur/… chunks that
          // only inflate the CDN pack budget.
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
