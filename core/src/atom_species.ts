import { PeriodicTableElements } from "./elements";
import type { Block } from "./molrs";

/** Render-facing species lookup. Atomic numbers take precedence over raw symbols. */
export class AtomSpecies {
  constructor(private readonly block: Block) {}
  has(): boolean {
    const block = this.block;
    return (
      block.has("atomic_number") ||
      (block.has("element") && block.dtype("element") === "string")
    );
  }

  /** Symbols for labels, palettes and radii; never modifies the source block. */
  symbols(): string[] {
    const block = this.block;
    if (!block.has("atomic_number")) {
      return block.has("element")
        ? Array.from(block.copy("element") as string[])
        : [];
    }
    if (block.dtype("atomic_number") !== "u64") {
      throw new TypeError("atoms.atomic_number must be u64");
    }
    return Array.from(
      block.copy("atomic_number") as BigUint64Array,
      (value) => {
        if (value === 0n) return "*";
        const element =
          value <= 118n ? PeriodicTableElements[Number(value) - 1] : undefined;
        if (!element) throw new RangeError(`Invalid atomic number ${value}`);
        return element.symbol;
      },
    );
  }
}
