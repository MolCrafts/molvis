/**
 * `@molcrafts/molvis-sketch-viewer` ships as dist/main.js and registers
 * `molvis-sketch`. Goldens are repo-derived: entry key from
 * sketch-viewer/rslib.config.ts, tag from sketch-viewer/src/element_entry.ts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../sketch-viewer/dist");
const sketchManifest = JSON.parse(
  readFileSync(join(here, "../sketch/package.json"), "utf8"),
) as { exports?: Record<string, unknown> };
assert(
  sketchManifest.exports?.["./element"] === undefined,
  "pack shape: @molcrafts/molvis-sketch still exports ./element — custom elements live on @molcrafts/molvis-sketch-viewer",
);
const entry = join(dist, "main.js");

assert(
  existsSync(entry),
  "pack shape: sketch-viewer/dist/main.js missing (bundled entry key must be 'main')",
);
const entryText = readFileSync(entry, "utf8");
assert(entryText.length > 0, "pack shape: sketch-viewer/dist/main.js is empty");

const numericChunk = /^[0-9]+\.js$/;
const numeric = readdirSync(dist, { withFileTypes: true })
  .filter((e) => e.isFile() && numericChunk.test(e.name))
  .map((e) => e.name);
assert(
  numeric.length === 0,
  `pack shape: numeric chunk name(s) at sketch-viewer/dist root: ${numeric.join(", ")}`,
);

const specifierRe = /["'](\.\/[^"']+\.js)["']/g;
const specifiers = [...entryText.matchAll(specifierRe)].map((m) => m[1]);
let haystack = entryText;
for (const spec of specifiers) {
  const chunk = join(dist, spec);
  if (!existsSync(chunk)) continue;
  haystack += readFileSync(chunk, "utf8");
}
assert(
  haystack.includes("molvis-sketch"),
  "pack shape: tag molvis-sketch absent from sketch-viewer/dist/main.js and its direct imports",
);

console.log("sketch-viewer-pack-shape ok");
