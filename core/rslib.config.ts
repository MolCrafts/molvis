import { defineConfig } from "@rslib/core";

/**
 * Unbundled library build for `@molcrafts/molvis-core`.
 * molrs is external so hosts share one WASM graph.
 *
 * Watch must not wipe `dist/` — dependents resolve package exports to dist,
 * and a clean mid-rebuild races stage/sketch/page (Module not found).
 */
export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      source: {
        entry: { index: "./src/**" },
      },
      output: {
        // Never empty dist. `stage` and `page` resolve `@molcrafts/molvis-core`
        // subpaths straight into it, and a build that wipes dist first opens a
        // window where those resolve to nothing — which rspack then *caches*,
        // so every later build fails with "Can't resolve" until the cache is
        // deleted by hand. The entry map is one file per module, so stale
        // output only appears if a source module is deleted.
        cleanDistPath: false,
        target: "web",
        externals: ["@molcrafts/molrs"],
      },
    },
  ],
});
