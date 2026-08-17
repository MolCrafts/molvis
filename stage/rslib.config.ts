import { defineConfig } from "@rslib/core";

/**
 * Library build for `@molcrafts/molvis-stage` (3D engine).
 *
 * Unbundled `dist/*.js` only. Page / plugin / vsc-ext consume this.
 * The CDN custom-element pack lives in `@molcrafts/molvis-stage-viewer`
 * and is not on this graph.
 *
 * molrs is reached only via `@molcrafts/molvis-core` (workspace private).
 * Never import `@molcrafts/molrs` here.
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
  ],
});
