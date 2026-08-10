import path from "node:path";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const root = import.meta.dirname;

/**
 * Product host (React). Engines resolve as normal workspace/npm packages
 * (`@molcrafts/molvis-stage`, `@molcrafts/molvis-sketch`, … → package exports
 * → dist). Root `npm run dev:page` starts engine watches first (ordered
 * core → stage+sketch → page); one-shot `build:page` runs `build:engines`.
 *
 * ``MOLVIS_PYTHON_DEV=1`` writes the bundle into the Python package tree.
 *
 * Workers need no config here: stage spawns them via the static
 * `new Worker(new URL("./worker.js", import.meta.url))` form, which rspack
 * folds into this build as worker chunks (trajectory + compute).
 * @see https://rsbuild.rs/guide/basic/web-workers
 */
const pythonDev = process.env.MOLVIS_PYTHON_DEV === "1";
const distRoot = pythonDev
  ? path.join("..", "python", "src", "molvis", "dist")
  : "dist";

export default defineConfig({
  server: {
    // No port/host: Rsbuild defaults (auto free port when 3000 is taken).
    // COOP/COEP: required for SharedArrayBuffer / pyodide kernel; drop these
    // and in-browser Python falls back to a broken comlink path.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [pluginReact()],
  html: {
    template: "./public/index.html",
  },
  output: {
    // Native ESM output (stable since Rsbuild 1.6 for web): entry + chunks
    // are real ES modules (`<script type="module">`), async chunks load via
    // dynamic `import()`, and module workers get `import`-based chunk
    // loading — no legacy importScripts anywhere. The Python notebook
    // loader injects these scripts with `type="module"` (scene.py).
    module: true,
    distPath: {
      root: distRoot,
      js: "js",
      jsAsync: "js/async",
      css: "css",
      cssAsync: "css/async",
      wasm: "wasm",
      image: "image",
      font: "font",
      media: "media",
      svg: "svg",
      assets: "assets",
    },
    cleanDistPath: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  performance: {
    chunkSplit: {
      strategy: "custom",
      splitChunks: {
        chunks: "all",
        cacheGroups: {
          babylonjs: {
            test: /[\\/]node_modules[\\/]@babylonjs[\\/](?!serializers)/,
            name: "lib-babylonjs",
            chunks: "initial",
            priority: 20,
          },
          react: {
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            name: "lib-react",
            chunks: "initial",
            priority: 15,
          },
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            name: "lib-vendors",
            chunks: "initial",
            priority: 10,
            minSize: 20000,
          },
        },
      },
    },
  },
  tools: {
    rspack(config) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
      // Unbundled stage dist uses `function f(){} export { f }`.
      config.module = {
        ...config.module,
        parser: {
          ...(config.module?.parser ?? {}),
          javascript: {
            ...(config.module?.parser?.javascript ?? {}),
            exportsPresence: "warn",
          },
        },
        rules: [
          ...(config.module?.rules ?? []),
          {
            resourceQuery: /raw/,
            type: "asset/source",
          },
        ],
      };
    },
  },
});
