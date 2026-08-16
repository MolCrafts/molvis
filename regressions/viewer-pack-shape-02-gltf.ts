/**
 * glTF export must leave the viewer pack and be reachable only through the
 * public `./export-gltf` subpath.
 *
 * Two halves, one contract:
 *
 *   1-3. The bundled viewer graph no longer reaches `export/gltf.ts`. Cutting
 *        `Molvis.exportGLTF` removes the only edge into it, so the async chunk
 *        it produced (`dist/1~gltf.js`, 4.8 kB) and the serializers chunk that
 *        hung off it (`dist/1~@babylonjs/serializers.js`, 298.5 kB) must both
 *        be absent, and the root barrel must no longer name `exportFrameToGLB`.
 *   4-5. The capability did not disappear, it moved: the deep module still
 *        loads and still exports a function, and `stage/package.json` points
 *        the new subpath at exactly those artifacts (manifest <-> artifact
 *        coherence — a manifest entry aimed at a file that is not emitted is a
 *        broken public API, not a passing one).
 *
 * Goldens are structural literals typed in here — chunk file names from the
 * pre-change build output, the symbol name from `stage/src/export/gltf.ts`, the
 * two manifest paths from the spec. No tool produced them, no third-party
 * oracle is consulted, nothing is captured at runtime.
 *
 * Ring 01 territory (`main.js`, `viewer.js`, numeric chunk names) is
 * deliberately NOT asserted here; `viewer-pack-shape-01-names.ts` owns it.
 *
 * Run with the repo TS runner: `node regressions/viewer-pack-shape-02-gltf.ts`
 * after `npm run build:stage`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** The shape of one `exports` entry we care about; `default` is not asserted. */
type SubpathExport = {
  types?: unknown;
  import?: unknown;
  default?: unknown;
};
type StageManifest = {
  exports?: Record<string, SubpathExport | string>;
};

const here = dirname(fileURLToPath(import.meta.url));
const stage = join(here, "../stage");
const dist = join(stage, "dist");

// --- (1) the glTF glue chunk left the viewer pack --------------------------

assert(
  !existsSync(join(dist, "1~gltf.js")),
  "pack shape: stage/dist/1~gltf.js still emitted — the viewer graph still reaches export/gltf.ts (Molvis.exportGLTF was the only edge into it and must be gone)",
);

// --- (2) and took the serializers chunk tree with it -----------------------

assert(
  !existsSync(join(dist, "1~@babylonjs")),
  "pack shape: stage/dist/1~@babylonjs/ still emitted — @babylonjs/serializers is still pulled into the viewer pack by the glTF exporter's lazy import",
);

// --- (3) the root barrel no longer re-exports the symbol -------------------

const barrel = readFileSync(join(dist, "index.js"), "utf8");
assert(
  !barrel.includes("exportFrameToGLB"),
  "public API: stage/dist/index.js still names exportFrameToGLB — the barrel re-export of ./export/gltf must be cut, the symbol lives on ./export-gltf now",
);

// --- (4) the capability moved, it was not deleted --------------------------

const gltf = await import("../stage/dist/export/gltf.js");
assert(
  typeof gltf.exportFrameToGLB === "function",
  `public API: ../stage/dist/export/gltf.js does not export exportFrameToGLB as a function (got ${typeof gltf.exportFrameToGLB}) — the ./export-gltf subpath would resolve to a module without the exporter`,
);

// --- (5) the manifest entry and the artifacts on disk agree ----------------

const manifest: StageManifest = JSON.parse(
  readFileSync(join(stage, "package.json"), "utf8"),
);
const subpath = manifest.exports?.["./export-gltf"];
const types = typeof subpath === "object" ? subpath.types : undefined;
const importPath = typeof subpath === "object" ? subpath.import : undefined;

assert(
  types === "./dist/export/gltf.d.ts",
  `public API: stage/package.json exports["./export-gltf"].types is ${JSON.stringify(types)}, expected "./dist/export/gltf.d.ts" — the new public subpath must carry its own types entry`,
);
assert(
  importPath === "./dist/export/gltf.js",
  `public API: stage/package.json exports["./export-gltf"].import is ${JSON.stringify(importPath)}, expected "./dist/export/gltf.js" — the new public subpath must resolve to the nested dist module`,
);
assert(
  existsSync(join(stage, "dist/export/gltf.d.ts")),
  "manifest/artifact mismatch: stage/package.json declares ./export-gltf types at ./dist/export/gltf.d.ts but that file is not emitted",
);
assert(
  existsSync(join(stage, "dist/export/gltf.js")),
  "manifest/artifact mismatch: stage/package.json declares ./export-gltf import at ./dist/export/gltf.js but that file is not emitted",
);

console.log("viewer-pack-shape-02-gltf ok");
