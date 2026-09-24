/**
 * Display rounding for numbers shown in menus, inspectors, and HUD readouts.
 *
 * Format-related values (scale, opacity, zoom, duration) use one or two
 * fraction digits. Scientific values (Å, energy, charge, force) use four
 * significant figures, switching to scientific notation outside
 * `[1e-3, 1e4)`.
 */
export class DisplayNumber {
  constructor(readonly value: number) {}

  /**
   * Compact UI readout. `fractionDigits` is 2 by default (1 for coarse
   * quantities like file size or lap time). Trailing zeros after the
   * decimal are dropped (`1.50` → `1.5`).
   */
  format(fractionDigits = 2): string {
    const value = this.value;
    if (!Number.isFinite(value)) return String(value);
    if (Object.is(value, -0) || value === 0) return "0";
    return DisplayNumber.trimZeros(value.toFixed(fractionDigits));
  }

  /**
   * Scientific readout: four significant figures, or scientific notation
   * when `|value| >= 1e4` or `0 < |value| < 1e-3`.
   */
  science(): string {
    const value = this.value;
    if (!Number.isFinite(value)) return String(value);
    if (Object.is(value, -0) || value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e4 || abs < 1e-3) {
      return value.toExponential(3).replace("e+", "e");
    }
    const precise = value.toPrecision(4);
    if (/e/i.test(precise)) return precise.replace("e+", "e");
    return DisplayNumber.trimZeros(precise);
  }

  private static trimZeros(text: string): string {
    const trimmed = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return trimmed === "-0" ? "0" : trimmed;
  }
}
