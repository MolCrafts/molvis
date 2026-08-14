/**
 * Public-API lock for Tab10 / Ovito strategies and vacated `ovito` ColorMap.
 * Goldens are literals (Tableau 10 / OVITO type table, 2026-08-14).
 */
import {
  OvitoStrategy,
  Tab10Strategy,
} from "../stage/dist/artist/categorical_theme.js";
import {
  getPaletteDefinition,
  listColorMaps,
  listPaletteDefinitions,
} from "../stage/dist/artist/palette.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const tab10 = new Tab10Strategy().colorForKeys(["opls_10", "opls_2", "opls_1"]);
assert(tab10.get("opls_1") === "#4E79A7", `opls_1 ${tab10.get("opls_1")}`);
assert(tab10.get("opls_2") === "#F28E2B", `opls_2 ${tab10.get("opls_2")}`);
assert(tab10.get("opls_10") === "#E15759", `opls_10 ${tab10.get("opls_10")}`);

const ovito = new OvitoStrategy();
assert(ovito.colorAt("1") === "#FF6666", `type 1 ${ovito.colorAt("1")}`);
assert(ovito.colorAt("Si1") === "#F0C8A0", `Si1 ${ovito.colorAt("Si1")}`);
assert(
  ovito.colorAt("opls_145") === "#6666FF",
  `opls_145 ${ovito.colorAt("opls_145")}`,
);

const summaries = listPaletteDefinitions();
const ovitoDef = summaries.find((p) => p.name === "ovito");
assert(
  ovitoDef?.kind === "categorical" && ovitoDef.size === 9,
  `ovito summary ${JSON.stringify(ovitoDef)}`,
);
assert(
  !listColorMaps().includes("ovito-elements"),
  "ovito-elements must stay internal",
);
assert(
  getPaletteDefinition("ovito").entries[1]?.color === "#FF6666",
  "ovito entries[1] must be type-1 salmon",
);

console.log("theme-tab10-ovito-01-strategies ok");
