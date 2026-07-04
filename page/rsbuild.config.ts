import path from "node:path";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  server: { port: 3000 },
  plugins: [pluginReact()],
  html: {
    template: "./public/index.html",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@molvis/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
      "@molvis/core/io/formats": path.resolve(
        import.meta.dirname,
        "../core/src/io/formats.ts",
      ),
      "@molvis/core/io": path.resolve(
        import.meta.dirname,
        "../core/src/io/index.ts",
      ),
      // @molcrafts/molplot resolves from node_modules (published Vega-Lite pkg).
    },
  },
  source: {
    define: {
      __WASM_INLINE__: "false",
    },
    watchFiles: {
      paths: [path.resolve(import.meta.dirname, "../core/src/**")],
    },
  },
  performance: {
    chunkSplit: {
      strategy: "custom",
      splitChunks: {
        chunks: "all",
        cacheGroups: {
          // BabylonJS core/gui/materials — sync, cached separately (large, stable)
          babylonjs: {
            test: /[\\/]node_modules[\\/]@babylonjs[\\/](?!inspector)/,
            name: "lib-babylonjs",
            chunks: "initial",
            priority: 20,
          },
          // React — sync, small
          react: {
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            name: "lib-react",
            chunks: "initial",
            priority: 15,
          },
          // Other sync vendor deps (Radix UI, etc.)
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
    rspack: {
      // Inline the raw text of `?raw` imports (e.g. CHANGELOG.md) as a string.
      module: {
        rules: [{ resourceQuery: /raw/, type: "asset/source" }],
      },
      node: {
        // kekule.js uses __dirname internally — mock it silently
        __dirname: "mock",
      },
      ignoreWarnings: [
        // kekule.js uses dynamic require internally — harmless in browser
        /Critical dependency/,
        /__dirname/,
      ],
    },
  },
});
