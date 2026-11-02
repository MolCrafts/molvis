import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { AtomMeta, BondMeta } from "../../src/entity_source";
import { formatHitInfo } from "../../src/mode/hit_info";

function atomHit(
  atomId: number,
  element: string,
  position: { x: number; y: number; z: number },
): { type: "atom"; metadata: AtomMeta } {
  return {
    type: "atom",
    metadata: { type: "atom", atomId, element, position },
  };
}

function xyzBlock(x: number, y: number, z: number): Block {
  const atoms = new Block();
  atoms.set("x", new Float64Array([x]));
  atoms.set("y", new Float64Array([y]));
  atoms.set("z", new Float64Array([z]));
  return atoms;
}

describe("formatHitInfo", () => {
  // ── Basics ──────────────────────────────────────────────────────────────
  it("names the pick on line one and puts position on the XYZ row", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    // Identity only on the header; `XYZ (…)` leads the body in the same
    // `key (x, y, z)` shape as the folded vector rows.
    expect(line).toBe("Atom 7 · C\nXYZ (1.00, 2.00, 3.00)");
    expect(line).not.toContain("Å");
  });

  it("shows type_id as a keyed data row when element is missing", () => {
    const atoms = xyzBlock(0, 0, 0);
    atoms.set("id", toDomainUint([1]));
    atoms.set("type_id", toDomainUint([2]));
    const line = formatHitInfo(atomHit(0, "", { x: 0, y: 0, z: 0 }), atoms);
    // A force-field kind is data, not a name — keyed in a row, never a bare
    // ordinal glued onto the identity line (`Atom 1 · 2 · XYZ`).
    expect(line).toBe("Atom 1\nXYZ (0.00, 0.00, 0.00)\ntype_id 2");
    expect(line).not.toContain("Atom Atom");
  });

  it("appends public extras in keys() order and omits ColorByProperty internals", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("charge", new Float64Array([-0.83]));
    atoms.set("mass", new Float64Array([12.01]));
    atoms.set("__color_r", new Float64Array([0.1]));
    atoms.set("__color_g", new Float64Array([0.2]));
    atoms.set("__color_b", new Float64Array([0.3]));
    atoms.set("xu", new Float64Array([10]));
    atoms.set("yu", new Float64Array([20]));
    atoms.set("zu", new Float64Array([30]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    expect(line.split("\n")).toHaveLength(3);
    expect(line).toBe(
      "Atom 7 · C\nXYZ (1.00, 2.00, 3.00)\ncharge -0.83 · mass 12.01",
    );
    expect(line).not.toContain("__color");
    // Wrapped coords are canvas-position noise — never rows.
    expect(line).not.toMatch(/^xu/m);
    expect(line).not.toMatch(/^yu/m);
    expect(line).not.toMatch(/^zu/m);
    expect(line).not.toMatch(/e[+-]?\d/i);
  });

  it("returns an empty string for an empty hit", () => {
    expect(formatHitInfo({ type: "empty" })).toBe("");
  });

  it("returns an empty string for a null hit", () => {
    expect(formatHitInfo(null)).toBe("");
  });

  it("formats a ribbon residue line", () => {
    expect(
      formatHitInfo({
        type: "ribbon",
        chainId: "B",
        resName: "ALA",
        resSeq: 42,
      }),
    ).toBe("Residue ALA 42 · chain B");
  });

  it("formats a bond with length in Å and formatBondLabel kind", () => {
    const metadata: BondMeta = {
      type: "bond",
      bondId: 0,
      atomId1: 0,
      atomId2: 1,
      bondType: 1,
      bondNumber: 1,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 3, y: 4, z: 0 },
    };
    expect(formatHitInfo({ type: "bond", metadata }, null, [0, 1])).toBe(
      "Bond 0–1 · 5.00 Å · single",
    );
  });

  // ── Edge ────────────────────────────────────────────────────────────────
  it("falls back to metadata.atomId when the atoms block has no id column", () => {
    expect(formatHitInfo(atomHit(7, "C", { x: 1, y: 2, z: 3 }))).toBe(
      "Atom 7 · C\nXYZ (1.00, 2.00, 3.00)",
    );
  });

  it("shows the type string as a keyed data row when element is empty", () => {
    const atoms = xyzBlock(0, 0, 0);
    atoms.set("id", toDomainUint([1]));
    atoms.set("element", ["  "]);
    atoms.set("type", ["CT"]);
    expect(formatHitInfo(atomHit(0, "  ", { x: 0, y: 0, z: 0 }), atoms)).toBe(
      "Atom 1\nXYZ (0.00, 0.00, 0.00)\ntype CT",
    );
  });

  it("keeps the identity line to Atom {id} when no element is present", () => {
    const atoms = xyzBlock(0, 0, 0);
    atoms.set("id", toDomainUint([5]));
    const line = formatHitInfo(atomHit(0, "", { x: 0, y: 0, z: 0 }), atoms);
    expect(line).toBe("Atom 5\nXYZ (0.00, 0.00, 0.00)");
    expect(line).not.toContain(" · · ");
    expect(line).not.toContain("Atom Atom");
  });

  it("prefixes residue name, id, and chain when res_name and res_id exist", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("res_name", ["THR"]);
    atoms.set("res_id", toDomainUint([222]));
    expect(formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms)).toBe(
      "Atom 7 · THR 222 · chain A · C\nXYZ (1.00, 2.00, 3.00)",
    );
  });

  it("skips residue columns from extras when the residue prefix is shown", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("res_name", ["THR"]);
    atoms.set("res_id", toDomainUint([222]));
    atoms.set("chain", ["A"]);
    atoms.set("charge", new Float64Array([-0.83]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    expect(line).toBe(
      "Atom 7 · THR 222 · chain A · C\nXYZ (1.00, 2.00, 3.00)\ncharge -0.83",
    );
    expect(line).not.toContain("res_name");
    expect(line).not.toContain("res_id");
    expect(line).not.toContain("\nchain ");
  });

  it("includes res_name as an extra when the residue prefix cannot be shown", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("res_name", ["THR"]);
    expect(formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms)).toBe(
      "Atom 7 · C\nXYZ (1.00, 2.00, 3.00)\nres_name THR",
    );
  });

  it("uses an explicit chain in the residue prefix", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("res_name", ["THR"]);
    atoms.set("res_id", toDomainUint([222]));
    atoms.set("chain", [" B "]);
    expect(formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms)).toBe(
      "Atom 7 · THR 222 · chain B · C\nXYZ (1.00, 2.00, 3.00)",
    );
  });

  it("groups *_1 *_2 *_3 extras onto one vector line", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("forces_1", new Float64Array([-0.5]));
    atoms.set("forces_2", new Float64Array([0.25]));
    atoms.set("forces_3", new Float64Array([1]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    // Same `key (x, y, z)` shape as the `XYZ (…)` row above it.
    expect(line).toBe(
      "Atom 7 · C\nXYZ (1.00, 2.00, 3.00)\nforces (-0.5, 0.25, 1)",
    );
  });

  it("groups x/y/z named triplets and folds them at the first component", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    // Column order is a dump's order: interleaved, not sorted.
    atoms.set("vz", new Float64Array([-0.16]));
    atoms.set("mass", new Float64Array([1]));
    atoms.set("vy", new Float64Array([0.2]));
    atoms.set("vx", new Float64Array([0.11]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    // Folded `v` lands where `vz` (the first component) sat — ahead of
    // `mass`, which the dump lists between the components. Vector rows are
    // `key (x, y, z)` like XYZ; scalars keep the padded key column.
    expect(line.split("\n")).toHaveLength(3);
    // `mass` leads the third line; the folded velocity follows it.
    expect(line).toBe(
      "Atom 7 · C\nXYZ (1.00, 2.00, 3.00)\nmass 1 · v (0.11, 0.2, -0.16)",
    );
  });

  it("keeps original keys for an incomplete x/y/z triplet", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    // Frame schema pins the image flags as int.
    atoms.set("ix", new Int32Array([2]));
    atoms.set("iz", new Int32Array([-1]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    expect(line).toBe("Atom 7 · C\nXYZ (1.00, 2.00, 3.00)\nix 2 · iz -1");
  });

  it("keeps a busy atom to three lines and leads the third with name, type, and charge", () => {
    const atoms = xyzBlock(1, 2, 3);
    atoms.set("element", ["C"]);
    atoms.set("id", toDomainUint([7]));
    atoms.set("vz", new Float64Array([-0.16]));
    atoms.set("name", ["C1"]);
    atoms.set("type", ["CT"]);
    atoms.set("charge", new Float64Array([-0.83]));
    atoms.set("note", ["tail"]);
    atoms.set("vy", new Float64Array([0.2]));
    atoms.set("vx", new Float64Array([0.11]));
    const line = formatHitInfo(atomHit(0, "C", { x: 1, y: 2, z: 3 }), atoms);
    expect(line.split("\n")).toEqual([
      "Atom 7 · C",
      "XYZ (1.00, 2.00, 3.00)",
      "name C1 · type CT · charge -0.83 · v (0.11, 0.2, -0.16) · note tail",
    ]);
  });

  it("formats an aromatic bond via formatBondLabel", () => {
    const metadata: BondMeta = {
      type: "bond",
      bondId: 3,
      atomId1: 4,
      atomId2: 5,
      bondType: 4,
      bondNumber: 0,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 0, z: 0 },
    };
    expect(formatHitInfo({ type: "bond", metadata }, null, [4, 5])).toBe(
      "Bond 4–5 · 1.00 Å · aromatic",
    );
  });
});
