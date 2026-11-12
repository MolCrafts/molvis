/**
 * Separate webview build for the optional Open Page surface.
 * Isolated so React/page never enter the Stage / Quick View / Sketch graph.
 */
import path from "node:path";
import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rslib/core";
import { molcraftsUiAlias } from "../page/molcrafts-ui-alias";

const sharedDefine = {
  "process.env.NODE_ENV": '"production"',
};

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: true,
      autoExternal: false,
      autoExtension: false,
      source: {
        entry: {
          "page/index": "./src/page/index.tsx",
        },
        define: sharedDefine,
      },
      output: {
        target: "web",
        distPath: { root: "out" },
        filename: { js: "[name].js", css: "chunks/page-styles.css" },
        chunkFilename: {
          js: "chunks/page-[name].js",
          css: "chunks/page-[name].css",
        },
        sourceMap: { js: false },
        cleanDistPath: false,
        externals: [],
        minify: true,
        // Inline every asset the page imports. An ESM library build emits a
        // bare `import logo from "../static/image/….png"` for an emitted
        // asset, and a browser refuses to load a PNG as a module script —
        // which takes the whole page chunk down with it. Data URIs keep the
        // reference inside the JS. (Wasm is not an asset module here; it
        // still ships as a file and is fetched by the runtime chunk.)
        dataUriLimit: {
          image: 8 * 1024 * 1024,
          svg: 8 * 1024 * 1024,
          font: 8 * 1024 * 1024,
          media: 8 * 1024 * 1024,
          assets: 8 * 1024 * 1024,
        },
      },
    },
  ],

  plugins: [pluginReact()],

  resolve: {
    alias: {
      // Page sources only. Engines resolve as @molcrafts/* packages.
      "@": path.resolve(import.meta.dirname, "../page/src"),
      // Same `@molcrafts/ui` intake as the page build (see the helper).
      ...molcraftsUiAlias(path.resolve(import.meta.dirname, "../page")),
      // Exact-match swap of stage's spawn seam for the webview graph:
      // the isolated chunks/worker.js + chunks/compute-worker.js load
      // via the vsc-ext blob bootstrap instead of in-graph literal
      // `new Worker(new URL(...))` folding.
      "@molcrafts/molvis-stage/worker-spawner$": path.resolve(
        import.meta.dirname,
        "./src/webview/worker_spawner.ts",
      ),
    },
  },

  tools: {
    rspack(config) {
      config.node = { ...(config.node || {}), __dirname: "mock" };
      config.module = {
        ...(config.module || {}),
        parser: {
          ...(config.module?.parser || {}),
          javascript: {
            ...(config.module?.parser?.javascript || {}),
            worker: false,
            exportsPresence: "warn",
          },
        },
        rules: [
          ...(config.module?.rules || []),
          { resourceQuery: /raw/, type: "asset/source" },
        ],
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
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        /Critical dependency/,
        /__dirname/,
        /Can't resolve 'vm'/,
        /Can't resolve 'fs'/,
      ];
      config.optimization = {
        ...config.optimization,
        minimize: true,
        runtimeChunk: { name: "chunks/page-runtime" },
        splitChunks: {
          chunks: "all",
          cacheGroups: {
            pageShared: {
              name: "chunks/page-shared",
              test: /[\\/](node_modules|core[\\/]dist|stage[\\/]dist|sketch[\\/]dist|page[\\/]src)[\\/]/,
              priority: 20,
              enforce: true,
              minSize: 0,
            },
          },
        },
      };
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
    },
  },
});
