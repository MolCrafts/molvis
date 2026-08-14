/**
 * Public-API lock for Cartoon name and PyMOL-like SS defaults.
 * Hex goldens: #E5533D / #F0C419 / #7DCE7A, 2026-08-14.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RIBBON_STYLE,
  displayRgbToHex,
  ssColor,
} from "../stage/dist/artist/ribbon/ribbon_style.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/dist/pipeline/draw_ribbon.js",
  ),
  "utf8",
);
assert(
  src.includes('NAME = "Cartoon"') || src.includes('NAME="Cartoon"'),
  "NAME Cartoon",
);

assert(displayRgbToHex(ssColor("helix")) === "#E5533D", "helix");
assert(displayRgbToHex(ssColor("sheet")) === "#F0C419", "sheet");
assert(displayRgbToHex(ssColor("coil")) === "#7DCE7A", "coil");
assert(
  displayRgbToHex(DEFAULT_RIBBON_STYLE.uniformColor) === "#7DCE7A",
  "uniform = coil",
);

console.log("theme-tab10-ovito-03-cartoon ok");
