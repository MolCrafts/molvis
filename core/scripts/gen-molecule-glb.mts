/**
 * Generate a .glb from a molecular structure file using molvis's own glTF
 * exporter — the same ball-and-stick geometry the engine renders, serialized
 * headlessly (no browser). This is what produces the docs demo asset; there is
 * no hand-written geometry anywhere.
 *
 *   npx tsx core/scripts/gen-molecule-glb.mts <input.sdf|xyz|pdb|...> <out.glb>
 *
 * molrs is now a wasm-bindgen `bundler` target that auto-initializes its WASM
 * on import, so this script must run through a bundler-aware / WASM-module
 * loader (e.g. `node --experimental-wasm-modules`) rather than a plain Node
 * invocation — Node cannot import `.wasm` natively. It then reuses core's
 * reader + exporter, same as before.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core";
import "@molcrafts/molrs";
import { exportFrameToGLB } from "../src/export/gltf";
import { readFrames } from "../src/io/reader";

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error("usage: gen-molecule-glb.mts <input structure> <out.glb>");
  }

  // molrs (bundler target) auto-initializes its WASM via the import above.
  const frames = readFrames(readFileSync(input, "utf8"), input);
  if (frames.length === 0) throw new Error(`no frames parsed from ${input}`);
  const frame = frames[0];

  const atoms = frame.getBlock("atoms");
  const bonds = frame.getBlock("bonds");
  console.log(
    `parsed ${input}: ${atoms?.nrows() ?? 0} atoms, ${bonds?.nrows() ?? 0} bonds`,
  );

  const engine = new NullEngine();
  const bytes = await exportFrameToGLB(frame, engine);
  writeFileSync(output, bytes);
  console.log(`wrote ${output} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
