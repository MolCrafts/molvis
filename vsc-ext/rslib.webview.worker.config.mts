import { createRequire } from "node:module";
import { defineConfig } from "@rslib/core";

const require = createRequire(import.meta.url);
/** Resolve published package entries (workspace/registry → dist file). */
const trajectoryWorkerEntry = require.resolve(
  "@molcrafts/molvis-stage/trajectory-worker",
);
const computeWorkerEntry = require.resolve(
  "@molcrafts/molvis-stage/compute-worker",
);

/**
 * VS Code webview — isolated workers (trajectory + compute)
 * =========================================================
 *
 * Built **after** the main webview config so `out/` already exists and is
 * not wiped. Emits self-contained ESM files:
 *
 *   out/chunks/worker.js          (trajectory)
 *   out/chunks/compute-worker.js  (compute / optimize)
 *
 * plus their shared wasm asset under `out/static/wasm/`.
 *
 * Must never share splitChunks / runtime with the main webview graph —
 * that dual-ownership is what produced null module exports on main. The
 * workers are one lib item **each**: two entries in one item make rspack
 * hoist their common modules into shared `out/*.js` chunks, breaking the
 * self-contained-file requirement.
 *
 * Loaded by `src/webview/spawnTrajectoryWorker.ts` /
 * `src/webview/spawnComputeWorker.ts` via
 * `new URL("./<file>.js", import.meta.url)` from the shared chunks.
 */

const sharedDefine = {
  "process.env.NODE_ENV": '"production"',
};

function isolatedWorkerLib(entryName: string, entryPath: string) {
  return {
    format: "esm" as const,
    bundle: true,
    autoExternal: false,
    autoExtension: false,
    source: {
      entry: {
        [entryName]: entryPath,
      },
      define: sharedDefine,
    },
    output: {
      target: "web" as const,
      distPath: { root: "out" },
      filename: { js: "[name].js" },
      sourceMap: { js: false },
      cleanDistPath: false,
      externals: [],
      minify: true,
    },
    tools: {
      rspack(config: {
        node?: object;
        resolve?: { fallback?: object };
        optimization?: object;
        experiments?: object;
        performance?: object;
      }) {
        config.node = {
          ...(config.node || {}),
          __dirname: "mock",
        };
        config.resolve = {
          ...(config.resolve || {}),
          fallback: {
            ...(config.resolve?.fallback || {}),
            vm: false,
            fs: false,
            path: false,
          },
        };
        config.optimization = {
          ...config.optimization,
          minimize: true,
          splitChunks: false,
          runtimeChunk: false,
        };
        config.experiments = {
          ...config.experiments,
          asyncWebAssembly: true,
        };
        config.performance = {
          hints: false,
          maxAssetSize: 15 * 1024 * 1024,
          maxEntrypointSize: 15 * 1024 * 1024,
        };
      },
    },
  };
}

export default defineConfig({
  lib: [
    isolatedWorkerLib("chunks/worker", trajectoryWorkerEntry),
    isolatedWorkerLib("chunks/compute-worker", computeWorkerEntry),
  ],
});
