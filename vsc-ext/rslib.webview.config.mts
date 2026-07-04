import path from "node:path";
import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rslib/core";

const sharedDefine = {
  __WASM_INLINE__: "false",
  "process.env.NODE_ENV": '"production"',
};

const vendorModulesPattern = /[\\/]node_modules[\\/]/;
const coreSourcePattern = /[\\/]core[\\/](src|dist)[\\/]/;

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: true,
      autoExternal: false,
      autoExtension: false,
      source: {
        entry: {
          "webview/index": "./src/webview/index.ts",
          "viewer/index": "./src/viewer/index.tsx",
        },
        define: sharedDefine,
      },
      output: {
        target: "web",
        distPath: { root: "out" },
        filename: { js: "[name].js", css: "[name].css" },
        chunkFilename: {
          js: "chunks/[name].js",
          css: "chunks/[name].css",
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
      "@molvis/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
      "@molvis/core/io/formats": path.resolve(
        import.meta.dirname,
        "../core/src/io/formats.ts",
      ),
      "@molvis/core/io": path.resolve(
        import.meta.dirname,
        "../core/src/io/index.ts",
      ),
      "@": path.resolve(import.meta.dirname, "../page/src"),
    },
  },

  tools: {
    rspack(config) {
      config.node = {
        ...(config.node || {}),
        __dirname: "mock",
      };
      // Inline the raw text of `?raw` imports (e.g. CHANGELOG.md) as a string.
      // Mirrors the same rule in page/rsbuild.config.ts — the page source this
      // webview bundles depends on it.
      config.module = {
        ...(config.module || {}),
        // rslib's library mode leaves `new Worker(new URL("./worker.js",
        // import.meta.url))` untouched, so the streaming trajectory worker is
        // never emitted. Re-enable rspack's default worker-syntax detection so
        // the worker is bundled as its own chunk and the URL is rewritten to
        // point at it. Required for the streaming load path (large .lammpstrj).
        parser: {
          ...(config.module?.parser || {}),
          javascript: {
            ...(config.module?.parser?.javascript || {}),
            worker: ["..."],
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
        usedExports: true,
        sideEffects: true,
        providedExports: true,
        innerGraph: true,
        concatenateModules: true,
        runtimeChunk: {
          name: "chunks/runtime",
        },
        splitChunks: {
          chunks: "all",
          cacheGroups: {
            // Kekule.js attaches its `Kekule` namespace to the global object as
            // a load-time side effect and references that global by bare name.
            // It is loaded lazily via dynamic `import("kekule")` (see
            // page/src/lib/kekule-loader.ts) and MUST stay in its own async
            // chunk: pulling it into the synchronous vendor chunk runs its
            // global-attach side effects under strict ESM scope before the
            // global exists, producing "Kekule is not defined" at runtime.
            // Higher priority than `vendor` so kekule wins the assignment, and
            // `chunks: "async"` keeps it out of the initial bundle entirely.
            kekule: {
              name: "chunks/kekule",
              test: /[\\/]node_modules[\\/]kekule[\\/]/,
              priority: 50,
              enforce: true,
              chunks: "async",
            },
            // Plotly (4.8 MB minified, bundles mapbox-gl + regl + d3) is only
            // reached through the React viewer's charts, and only via a dynamic
            // `import("plotly.js-dist-min")` (see core/src/charts/plotly_loader).
            // Without a dedicated group the `vendor` rule below (chunks:"all")
            // hoists it into the synchronous vendor chunk, so the file-open
            // webview — which never renders a chart — still pays to download and
            // parse all of plotly. Pin it to its own async-only chunk (like
            // kekule) so it loads lazily on first chart and stays out of the
            // initial bundle entirely.
            plotly: {
              name: "chunks/plotly",
              test: /[\\/]node_modules[\\/]plotly\.js-dist-min[\\/]/,
              priority: 50,
              enforce: true,
              chunks: "async",
            },
            // The Babylon Inspector is a debug-only panel, lazy-loaded via
            // `import("@babylonjs/inspector")` (see core/src/world.ts) and it
            // drags in @babylonjs/loaders + serializers (the whole glTF stack).
            // Same `chunks:"all"` hoisting bug as plotly: without this group it
            // lands in the synchronous vendor chunk, so every opened file pays
            // for several MB of debug tooling it never touches. Keep it async so
            // it only loads when the user actually toggles the inspector.
            // (@babylonjs/gui + materials are used at render time and stay in
            // vendor — they are intentionally not listed here.)
            babylonInspector: {
              name: "chunks/babylon-inspector",
              test: /[\\/]node_modules[\\/]@babylonjs[\\/](inspector|loaders|serializers)[\\/]/,
              priority: 55,
              enforce: true,
              chunks: "async",
            },
            // Collect all *initial* CSS (the viewer's tailwind bundle, which
            // tailwind v4 sources from node_modules/tailwindcss and would
            // otherwise be absorbed into `chunks/vendor.css`) into one stable,
            // hashless chunk that html.ts links explicitly. A dedicated name
            // (not an entry name) avoids the "merge into existing chunk"
            // collision. `chunks: "initial"` leaves async CSS (kekule's theme)
            // in its own chunk, loaded on demand by the chunk runtime.
            styles: {
              name: "chunks/styles",
              type: "css/mini-extract",
              priority: 100,
              enforce: true,
              chunks: "initial",
            },
            vendor: {
              name: "chunks/vendor",
              test: vendorModulesPattern,
              priority: 40,
              enforce: true,
              chunks: "all",
            },
            molrs: {
              name: "chunks/molrs",
              test: /[\\/]node_modules[\\/]@molcrafts[\\/]molrs[\\/]/,
              priority: 35,
              enforce: true,
              chunks: "all",
            },
            molvisCore: {
              name: "chunks/molvis-core",
              test: coreSourcePattern,
              priority: 30,
              enforce: true,
              chunks: "all",
            },
          },
        },
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
});
