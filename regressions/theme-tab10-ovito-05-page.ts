/**
 * Page wells bind these public setters. Picker DOM is locked by page tests.
 * SS goldens: #E5533D / #F0C419 / #7DCE7A. Liquid/solid: #4E79A7 / #E15759.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RIBBON_STYLE,
  displayRgbToHex,
} from "../stage/dist/artist/ribbon/ribbon_style.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function toHex(rgb: readonly [number, number, number]): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`.toUpperCase();
}

assert(toHex(DEFAULT_RIBBON_STYLE.helixColor) === "#E5533D", "helix");
assert(toHex(DEFAULT_RIBBON_STYLE.sheetColor) === "#F0C419", "sheet");
assert(toHex(DEFAULT_RIBBON_STYLE.coilColor) === "#7DCE7A", "coil");
assert(
  displayRgbToHex(DEFAULT_RIBBON_STYLE.helixColor) === "#E5533D",
  "hex helper",
);

const sl = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/dist/modifiers/SolidLiquidModifier.js",
  ),
  "utf8",
);
assert(sl.includes("#4E79A7"), "liquid default");
assert(sl.includes("#E15759"), "solid default");
assert(sl.includes("setLiquidColor"), "liquid setter");
assert(sl.includes("setSolidColor"), "solid setter");

const root = dirname(fileURLToPath(import.meta.url));
const style = readFileSync(
  join(root, "../page/src/ui/layout/StageStyleSection.tsx"),
  "utf8",
);
assert(style.includes('id: "tab10"'), "tab10 picker");
assert(style.includes('id: "ovito"'), "ovito picker");
assert(!style.includes("VividTheme"), "no VividTheme");
assert(!style.includes("ClassicTheme"), "no ClassicTheme");

const cartoon = readFileSync(
  join(root, "../page/src/ui/modes/view/modifiers/DrawRibbonModifier.tsx"),
  "utf8",
);
assert(cartoon.includes("Cartoon"), "Cartoon copy");
assert(cartoon.includes("setHelixColor"), "helix setter");
assert(cartoon.includes("setSheetColor"), "sheet setter");
assert(cartoon.includes("setCoilColor"), "coil setter");

console.log("theme-tab10-ovito-05-page ok");
