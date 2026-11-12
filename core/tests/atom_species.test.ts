import { describe, expect, it } from "@rstest/core";
import { AtomSpecies } from "../src/atom_species";
import { Block } from "../src/molrs";

describe("AtomSpecies", () => {
  it("uses canonical atomic numbers over stale raw symbols without mutating", () => {
    const block = new Block();
    try {
      block.set("atomic_number", new BigUint64Array([6n, 8n, 0n, 118n]));
      block.set("element", ["H", "H", "H", "H"]);
      expect(new AtomSpecies(block).has()).toBe(true);
      expect(new AtomSpecies(block).symbols()).toEqual(["C", "O", "*", "Og"]);
      expect(Array.from(block.copy("element") as string[])).toEqual([
        "H",
        "H",
        "H",
        "H",
      ]);
    } finally {
      block.free();
    }
  });

  it("reads raw symbols at a file boundary and distinguishes type-only data", () => {
    const block = new Block();
    try {
      block.set("type", ["water"]);
      expect(new AtomSpecies(block).has()).toBe(false);
      block.set("element", ["O"]);
      expect(new AtomSpecies(block).symbols()).toEqual(["O"]);
    } finally {
      block.free();
    }
  });
});
