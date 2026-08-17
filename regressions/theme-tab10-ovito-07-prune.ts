/**
 * ClassicTheme / VividTheme must not appear on the published barrel.
 * Reads dist/index.js so we do not boot the full WASM/DOM entry.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPaletteDefinition } from "../stage/dist/artist/palette.js";
import { ModernTheme } from "../stage/dist/artist/presets/modern.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const barrel = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../stage/dist/index.js"),
  "utf8",
);
assert(!barrel.includes("ClassicTheme"), "barrel mentions ClassicTheme");
assert(!barrel.includes("VividTheme"), "barrel mentions VividTheme");
assert(barrel.includes("ModernTheme"), "barrel missing ModernTheme");
assert(new ModernTheme().name === "Modern", "ModernTheme constructs");
assert(
  getPaletteDefinition("cpk").entries.find((e) => e.label === "C")?.color ===
    "#909090",
  "cpk C",
);
assert(
  getPaletteDefinition("vivid").entries.find((e) => e.label === "C")?.color ===
    "#909090",
  "vivid C",
);

console.log("theme-tab10-ovito-07-prune ok");
