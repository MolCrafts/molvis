/**
 * The bundled stage CDN entry must ship as dist/main.js with readable chunk
 * names, and must still carry the custom-element registrations.
 *
 * Goldens are repo-derived literals: the entry key comes from the bundled lib
 * item in stage/rslib.config.ts, the tag names from stage/src/element_entry.ts
 * (defineMolvisViewer / defineMolvisStyleGallery). No third-party oracle, no
 * WASM instantiation — this only reads emitted text.
 *
 * Ring 02 chunks (dist/1~gltf.js, dist/1~@babylonjs/*) coexist with this ring
 * and are deliberately NOT asserted on.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dist = join(dirname(fileURLToPath(import.meta.url)), "../stage/dist");
const entry = join(dist, "main.js");

// (a) the bundled CDN entry exists under its new name and carries payload.
assert(
  existsSync(entry),
  "pack shape: bundled CDN entry stage/dist/main.js missing (rslib bundled lib item must emit entry key 'main')",
);
const entryText = readFileSync(entry, "utf8");
assert(
  entryText.length > 0,
  "pack shape: stage/dist/main.js is empty (bundled CDN entry emitted no payload)",
);

// (b) the old entry name is gone, not coexisting with the new one.
assert(
  !existsSync(join(dist, "viewer.js")),
  "pack shape: stage/dist/viewer.js still present (old CDN entry name must be renamed, never duplicated alongside main.js)",
);

// (c) no purely-numeric chunk names at the dist ROOT (7642.js and friends).
// Root entries only — no recursion. `1~gltf.js` / `1~lib-babylonjs.js` start
// with a digit but are not purely numeric, and the anchored regex spares them.
const numericChunk = /^[0-9]+\.js$/;
const rootEntries = readdirSync(dist, { withFileTypes: true });
const numeric = rootEntries
  .filter((e) => e.isFile() && numericChunk.test(e.name))
  .map((e) => e.name);
assert(
  numeric.length === 0,
  `pack shape: numeric chunk name(s) at stage/dist root: ${numeric.join(", ")} (rspack chunkIds must be named, not numeric)`,
);

// (d) sideEffects sentinel: the custom-element tags must survive tree-shaking.
// main.js may be a bare import stub whose payload lives in the chunk it pulls
// in, so follow the entry's relative import specifiers exactly ONE level.
const specifierRe = /["'](\.\/[^"']+\.js)["']/g;
const specifiers = [...entryText.matchAll(specifierRe)].map((m) => m[1]);
const searched = ["main.js"];
let haystack = entryText;
for (const spec of specifiers) {
  const chunk = join(dist, spec);
  if (!existsSync(chunk)) continue;
  searched.push(spec);
  haystack += readFileSync(chunk, "utf8");
}
for (const tag of ["molvis-viewer", "molvis-style-gallery"]) {
  assert(
    haystack.includes(tag),
    `pack shape: custom element tag "${tag}" absent from stage/dist/main.js and its direct imports (${searched.join(", ")}) — stage/package.json sideEffects must list ./dist/main.js or element_entry.ts registrations get tree-shaken`,
  );
}

console.log("viewer-pack-shape-01-names ok");
