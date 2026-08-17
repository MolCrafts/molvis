/**
 * Separate webview build for the optional Open Page surface.
 * Isolated so React/page never enter the QV / Workbench / Sketch graph.
 */
import path from "node:path";
import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rslib/core";
import {
  ComputeSpawnRewrite,
  TrajectoryRuntimeRewrite,
} from "./rslib.webview.worker-rewrites.mts";

const sharedDefine = {
  "process.env.NODE_ENV": '"production"',
};

const trajectoryRuntimeRewrite = new TrajectoryRuntimeRewrite(
  import.meta.dirname,
);
const computeSpawnRewrite = new ComputeSpawnRewrite(import.meta.dirname);

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
      },
    },
  ],

  plugins: [pluginReact()],

  resolve: {
    alias: {
      // Page sources only. Engines resolve as @molcrafts/* packages.
      "@": path.resolve(import.meta.dirname, "../page/src"),
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
      config.plugins = [
        ...(config.plugins ?? []),
        trajectoryRuntimeRewrite.plugin(),
        computeSpawnRewrite.plugin(),
      ];
    },
  },
});
