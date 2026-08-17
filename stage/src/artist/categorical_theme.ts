/**
 * Fixed categorical coloring strategies (product theme ids `tab10` / `ovito`).
 *
 * These are stateless assignment algorithms, not generated palettes. Callers
 * construct them directly (`new Tab10Strategy()`) and map keys to uppercase
 * sRGB `#RRGGBB` hex.
 */
import { normalizeElement } from "../system/elements";
import { compareNaturalKeys, stableStringHash } from "./palette_keys";

/** OVITO numeric type colors, 0-based (`abs(id) % 9`). Type 1 is salmon. */
export const OVITO_TYPE_COLORS = [
  "#F7F7F7",
  "#FF6666",
  "#6666FF",
  "#FFFF00",
  "#FF66FF",
  "#66FF33",
  "#CCFFB3",
  "#B300FF",
  "#33FFFF",
] as const;

let defaultElementHex: Readonly<Record<string, string>> = {};

/** Bind the 118-element OVITO CPK table after palette init (avoids a cycle). */
export function bindOvitoElementHex(
  table: Readonly<Record<string, string>>,
): void {
  defaultElementHex = table;
}

const TAB10_COLORS = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
] as const;

/**
 * @description Contract for a product categorical theme: assign one hex
 * colour per key, or one colour at a numeric ordinal.
 */
export interface CategoricalColorStrategy {
  colorForKeys(
    keys: Iterable<string>,
    numericIds?: ReadonlyMap<string, number>,
  ): Map<string, string>;
  colorAt(key: string, numericId?: number): string;
}

function tab10At(numericId: number | undefined): string {
  const id = Number.isInteger(numericId) ? Math.abs(numericId as number) : 0;
  return TAB10_COLORS[id % TAB10_COLORS.length];
}

/**
 * @description Tableau 10 cycle. `colorForKeys` sorts unique keys with
 * {@link compareNaturalKeys} then walks the ten swatches; `colorAt` is the
 * ordinal primitive (`numericId % 10`) and ignores `key`.
 *
 * @example
 * ```ts
 * const theme = new Tab10Strategy();
 * theme.colorForKeys(["opls_10", "opls_2", "opls_1"]).get("opls_1");
 * // "#4E79A7"
 * ```
 */
export class Tab10Strategy implements CategoricalColorStrategy {
  /**
   * @description Map each distinct key to a Tableau 10 swatch.
   * @param keys - Category keys; order does not affect the mapping.
   * @param _numericIds - Ignored; Tab10 is sort-order, not type-id.
   * @returns New `Map` of key → uppercase `#RRGGBB`.
   */
  public colorForKeys(
    keys: Iterable<string>,
    _numericIds?: ReadonlyMap<string, number>,
  ): Map<string, string> {
    const unique = Array.from(new Set(keys));
    unique.sort(compareNaturalKeys);
    const out = new Map<string, string>();
    for (let i = 0; i < unique.length; i++) {
      out.set(unique[i], TAB10_COLORS[i % TAB10_COLORS.length]);
    }
    return out;
  }

  /**
   * @description Tableau 10 colour at a numeric ordinal.
   * @param _key - Unused.
   * @param numericId - 0-based ordinal; defaults to 0. Negative values use abs.
   * @returns Uppercase `#RRGGBB`.
   */
  public colorAt(_key: string, numericId?: number): string {
    return tab10At(numericId);
  }
}

function isOwnHex(
  table: Readonly<Record<string, string>>,
  symbol: string,
): string | undefined {
  return Object.hasOwn(table, symbol) ? table[symbol] : undefined;
}

/**
 * @description OVITO particle-type colours. Tries (1) strip-to-element CPK,
 * (2) whole-string integer `abs(id) % 9`, (3) optional `numericId`,
 * (4) {@link stableStringHash} `% 9`. Type `"1"` is always salmon `#FF6666`.
 *
 * @example
 * ```ts
 * const theme = new OvitoStrategy();
 * theme.colorAt("1");   // "#FF6666"
 * theme.colorAt("Si1"); // "#F0C8A0"
 * ```
 */
export class OvitoStrategy implements CategoricalColorStrategy {
  private readonly injected?: Readonly<Record<string, string>>;

  /**
   * @param elementHexBySymbol - Optional element → hex table for tests.
   *   Defaults to the bound OVITO CPK table (set when palette.ts loads).
   */
  public constructor(elementHexBySymbol?: Readonly<Record<string, string>>) {
    this.injected = elementHexBySymbol;
  }

  private get elements(): Readonly<Record<string, string>> {
    return this.injected ?? defaultElementHex;
  }

  /**
   * @description Independent per-key assignment (no sort).
   * @param keys - Category keys.
   * @param numericIds - Optional type-id override for non-integer names.
   * @returns New `Map` of key → uppercase `#RRGGBB`.
   */
  public colorForKeys(
    keys: Iterable<string>,
    numericIds?: ReadonlyMap<string, number>,
  ): Map<string, string> {
    const out = new Map<string, string>();
    for (const key of new Set(keys)) {
      out.set(key, this.colorAt(key, numericIds?.get(key)));
    }
    return out;
  }

  /**
   * @description Resolve one key by the OVITO strip / id / hash ladder.
   * @param key - Type name (element, integer id, or force-field label).
   * @param numericId - Used only when `key` is not an element or integer.
   * @returns Uppercase `#RRGGBB`.
   */
  public colorAt(key: string, numericId?: number): string {
    const current = key.trim();
    const fromElement = this.hexForElementName(current);
    if (fromElement) return fromElement;

    if (/^[+-]?\d+$/.test(current)) {
      return OVITO_TYPE_COLORS[Math.abs(Number.parseInt(current, 10)) % 9];
    }
    if (Number.isInteger(numericId)) {
      return OVITO_TYPE_COLORS[Math.abs(numericId as number) % 9];
    }
    return OVITO_TYPE_COLORS[stableStringHash(current) % 9];
  }

  private hexForElementName(name: string): string | undefined {
    const exact = isOwnHex(this.elements, normalizeElement(name));
    if (exact) return exact;
    if (name.length < 2 || name.length > 5) return undefined;

    const hasDigit = /\d/.test(name);
    let current = name;
    while (current.length >= 2) {
      const stripped = current.slice(-1);
      current = current.slice(0, -1);
      const symbol = normalizeElement(current);
      const hex = isOwnHex(this.elements, symbol);
      if (!hex) continue;
      if (symbol.length >= 2) return hex;
      // One-letter symbols (H, C, W, …) only after a non-letter peel or a
      // digit in the original name — otherwise "water" becomes tungsten.
      if (hasDigit || !/[a-zA-Z]/.test(stripped)) return hex;
    }
    return undefined;
  }
}
