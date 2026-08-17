/**
 * The `@molcrafts/molvis-stage-viewer` CDN entry must ship as dist/main.js
 * with readable chunk names, and must still carry the custom-element
 * registrations.
 *
 * Goldens are repo-derived literals: the entry key comes from
 * stage-viewer/rslib.config.ts, the tag names from
 * stage-viewer/src/element_entry.ts (defineMolvisViewer /
 * defineMolvisStyleGallery). No third-party oracle, no WASM instantiation
 * — this only reads emitted text.
 *
 * Ring 02 chunks (1~gltf.js, 1~@babylonjs/*) coexist with this ring and are
 * deliberately NOT asserted on.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../stage-viewer/dist");
const entry = join(dist, "main.js");
const stageManifest = JSON.parse(
  readFileSync(join(here, "../stage/package.json"), "utf8"),
) as { exports?: Record<string, unknown> };
assert(
  stageManifest.exports?.["./element"] === undefined,
  "pack shape: @molcrafts/molvis-stage still exports ./element — custom elements live on @molcrafts/molvis-stage-viewer",
);
assert(
  stageManifest.exports?.["./viewer"] === undefined,
  "pack shape: @molcrafts/molvis-stage still exports ./viewer — the CDN pack left the engine",
);

// (a) the bundled CDN entry exists under its new name and carries payload.
assert(
  existsSync(entry),
  "pack shape: bundled CDN entry stage-viewer/dist/main.js missing (rslib bundled lib item must emit entry key 'main')",
);
const entryText = readFileSync(entry, "utf8");
assert(
  entryText.length > 0,
  "pack shape: stage-viewer/dist/main.js is empty (bundled CDN entry emitted no payload)",
);

// (b) the old entry name is gone, not coexisting with the new one.
assert(
  !existsSync(join(dist, "viewer.js")),
  "pack shape: stage-viewer/dist/viewer.js still present (old CDN entry name must stay gone)",
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
    `pack shape: custom element tag "${tag}" absent from stage-viewer/dist/main.js and its direct imports (${searched.join(", ")}) — @molcrafts/molvis-stage-viewer sideEffects must list ./dist/main.js or element_entry.ts registrations get tree-shaken`,
  );
}

// (e) author-facing WC tokens stay locked to the engine representation table.
// Read source text — do not import element.js in Node (HTMLElement is missing).
function quotedStringsAfter(src: string, marker: string): string[] {
  const start = src.indexOf(marker);
  assert(start >= 0, `pack shape: marker ${marker} missing`);
  const brace = src.indexOf("[", start);
  const end = src.indexOf("]", brace);
  return [...src.slice(brace, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
const engineIds = quotedStringsAfter(
  readFileSync(join(here, "../stage/src/artist/representation.ts"), "utf8"),
  "export const REPRESENTATION_IDS",
);
const viewerIds = quotedStringsAfter(
  readFileSync(join(here, "../stage-viewer/src/element.ts"), "utf8"),
  "export const MOLVIS_VIEWER_REPRESENTATIONS",
);
assert(
  JSON.stringify(engineIds) === JSON.stringify(viewerIds),
  `pack shape: MOLVIS_VIEWER_REPRESENTATIONS ${JSON.stringify(viewerIds)} !== stage REPRESENTATION_IDS ${JSON.stringify(engineIds)}`,
);

console.log("viewer-pack-shape-01-names ok");
