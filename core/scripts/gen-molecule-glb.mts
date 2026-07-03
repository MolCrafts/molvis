/**
 * Generate a .glb from a molecular structure file using molvis's own glTF
 * exporter — the same ball-and-stick geometry the engine renders, serialized
 * headlessly (no browser). This is what produces the docs demo asset; there is
 * no hand-written geometry anywhere.
 *
 *   npx tsx core/scripts/gen-molecule-glb.mts <input.sdf|xyz|pdb|...> <out.glb>
 *
 * Runs in Node by initializing the molrs WASM (a wasm-bindgen `web` target)
 * with the packaged .wasm bytes, then reusing core's reader + exporter.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { NullEngine } from "@babylonjs/core";
import initMolrs from "@molcrafts/molrs";
import { exportFrameToGLB } from "../src/export/gltf";
import { readFrames } from "../src/io/reader";

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error("usage: gen-molecule-glb.mts <input structure> <out.glb>");
  }

  // molrs is a wasm-bindgen "web" target: initialize it with the packaged bytes.
  const require = createRequire(import.meta.url);
  const molrsDir = dirname(require.resolve("@molcrafts/molrs"));
  await initMolrs(readFileSync(join(molrsDir, "molwasm_bg.wasm")));

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
