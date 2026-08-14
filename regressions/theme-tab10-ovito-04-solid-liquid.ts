/**
 * Public-API lock for Solid–liquid draw colors.
 * Linear goldens: offline hexToLinearRgb of #4E79A7 / #E15759, 2026-08-14.
 * Modifier apply is locked by stage/tests (molrs WASM); this script stays
 * WASM-free and checks the published hex → linear conversion.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToLinearRgb } from "../stage/dist/artist/palette.js";

const src = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/dist/modifiers/SolidLiquidModifier.js",
  ),
  "utf8",
);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function close(
  a: readonly number[] | undefined,
  b: readonly number[],
  eps = 1e-5,
): boolean {
  return !!a && a.every((v, i) => Math.abs(v - b[i]) < eps);
}

assert(src.includes("#4E79A7"), "default liquid hex");
assert(src.includes("#E15759"), "default solid hex");
assert(src.includes("setLiquidColor"), "setLiquidColor");
assert(src.includes("setSolidColor"), "setSolidColor");

const LIQUID = [0.07618538148130785, 0.1912016827407914, 0.386429433787049];
const SOLID = [0.7529422167760779, 0.0953074666309647, 0.09989872824711389];
assert(close(hexToLinearRgb("#4E79A7"), LIQUID), "liquid linear");
assert(close(hexToLinearRgb("#E15759"), SOLID), "solid linear");
assert(close(hexToLinearRgb("#00FF00"), [0, 1, 0]), "lime after setter");
assert(close(hexToLinearRgb("#0000FF"), [0, 0, 1]), "blue after setter");

console.log("theme-tab10-ovito-04-solid-liquid ok");
