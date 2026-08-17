/**
 * Public-API lock for strategy lookup after StyleManager wiring.
 * Goldens: offline sRGB→linear of Tableau 10 / OVITO type 1, 2026-08-14.
 */
import { OvitoStrategy } from "../stage/dist/artist/categorical_theme.js";
import {
  buildCategoricalColorLookup,
  categoricalColorAt,
  hexToLinearRgb,
} from "../stage/dist/artist/palette.js";
import { ModernTheme } from "../stage/dist/artist/presets/modern.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function close(
  a: readonly number[] | undefined,
  b: readonly number[],
  eps = 1e-6,
): boolean {
  return !!a && a.every((v, i) => Math.abs(v - b[i]) < eps);
}

const lookup = buildCategoricalColorLookup(["opls_1", "opls_2", "opls_10"]);
assert(
  close(lookup.get("opls_1"), hexToLinearRgb("#4E79A7")),
  `opls_1 ${lookup.get("opls_1")}`,
);
assert(
  close(lookup.get("opls_2"), hexToLinearRgb("#F28E2B")),
  `opls_2 ${lookup.get("opls_2")}`,
);
assert(
  close(lookup.get("opls_10"), hexToLinearRgb("#E15759")),
  `opls_10 ${lookup.get("opls_10")}`,
);

const ovito = buildCategoricalColorLookup(["1"], {
  strategy: new OvitoStrategy(),
});
assert(close(ovito.get("1"), hexToLinearRgb("#FF6666")), "ovito type 1");
assert(close(categoricalColorAt(1), hexToLinearRgb("#F28E2B")), "ordinal 1");
assert(new ModernTheme().name === "Modern", "ModernTheme still constructs");

console.log("theme-tab10-ovito-02-wire ok");
