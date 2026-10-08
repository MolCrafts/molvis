import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import {
  compatibleAugmentLengths,
  composeSources,
  extendFrames,
} from "../../src/system/source_composition";
import { Trajectory } from "../../src/system/trajectory";

function atoms(elements: string[], x0 = 0): Frame {
  const frame = new Frame();
  const block = new Block();
  block.set("x", new Float64Array(elements.map((_, i) => x0 + i)));
  block.set("y", new Float64Array(elements.length));
  block.set("z", new Float64Array(elements.length));
  block.set("element", elements);
  frame.set("atoms", block);
  return frame;
}

function setAtomF(frame: Frame, key: string, values: number[]): void {
  if (!frame.has("atoms")) throw new Error("missing atoms block");
  const block = frame.get("atoms");
  block.set(key, Float64Array.from(values));
}

function setAtomStr(frame: Frame, key: string, values: string[]): void {
  if (!frame.has("atoms")) throw new Error("missing atoms block");
  const block = frame.get("atoms");
  block.set(key, values);
}

function setAtomU32(frame: Frame, key: string, values: number[]): void {
  if (!frame.has("atoms")) throw new Error("missing atoms block");
  const block = frame.get("atoms");
  block.set(key, toDomainUint(values));
}

function bonds(pairs: Array<[number, number]>): Frame {
  const frame = new Frame();
  const block = new Block();
  block.set("atomi", toDomainUint(pairs.map((p) => p[0])));
  block.set("atomj", toDomainUint(pairs.map((p) => p[1])));
  block.set("bond_type", toDomainUint(new Uint32Array(pairs.length).fill(1)));
  block.set("bond_number", toDomainUint(new Uint32Array(pairs.length).fill(1)));
  frame.set("bonds", block);
  return frame;
}

describe("composeSources single source", () => {
  it("returns the provider frame handle when no contributed-block filter applies", async () => {
    const frame = atoms(["C", "O"]);
    const out = await composeSources(
      [{ id: "only", trajectory: new Trajectory([frame]) }],
      0,
    );
    expect(out).toBe(frame);
  });

  it("projects a copy when a contributed-block filter applies", async () => {
    const frame = atoms(["C", "O"]);
    frame.set("bonds", bonds([[0, 1]]).get("bonds"));
    const out = await composeSources(
      [
        {
          id: "only",
          trajectory: new Trajectory([frame]),
          contributedBlocks: ["atoms"],
        },
      ],
      0,
    );
    expect(out).not.toBe(frame);
    expect(out.get("atoms").nRows).toBe(2);
    expect(out.has("bonds")).toBe(false);
    expect(frame.get("bonds").nRows).toBe(1);
  });
});

describe("composeSources augment", () => {
  it("preserves volumetric block shapes through source projection", async () => {
    const frame = atoms(["C"]);
    const grid = new Block();
    grid.set("density", new Float64Array(24));
    grid.setShape([2, 3, 4]);
    frame.set("grid", grid);

    const out = await composeSources(
      [{ id: "volume", trajectory: new Trajectory([frame]) }],
      0,
    );

    expect(out.get("grid").structuralShape).toEqual([2, 3, 4]);
  });

  it("broadcasts length-1 sources and unions blocks", async () => {
    const traj = new Trajectory([atoms(["C", "O"], 0), atoms(["C", "O"], 10)]);
    const topo = new Trajectory([bonds([[0, 1]])]);

    const out = await composeSources(
      [
        { id: "traj", trajectory: traj },
        { id: "topo", trajectory: topo },
      ],
      1,
    );

    expect(
      Array.from((out.get("atoms").copy("x") as Float64Array) ?? []),
    ).toEqual([10, 11]);
    expect(out.get("bonds").nRows).toBe(1);
  });

  it("merges same-name atom blocks by column with later sources winning duplicates", async () => {
    const base = atoms(["C"], 0);
    setAtomF(base, "charge", [-0.2]);
    const overlay = atoms(["O"], 9);
    setAtomF(overlay, "mass", [16]);

    const out = await composeSources(
      [
        { id: "base", trajectory: new Trajectory([base]) },
        { id: "overlay", trajectory: new Trajectory([overlay]) },
      ],
      0,
    );

    const atomsBlock = out.has("atoms") ? out.get("atoms") : undefined;
    expect(Array.from((atomsBlock?.copy("x") as Float64Array) ?? [])).toEqual([
      9,
    ]);
    expect([...(atomsBlock?.copy("element") as string[])]).toEqual(["O"]);
    expect(
      Array.from((atomsBlock?.copy("charge") as Float64Array) ?? []),
    ).toEqual([-0.2]);
    expect(
      Array.from((atomsBlock?.copy("mass") as Float64Array) ?? []),
    ).toEqual([16]);
  });

  it("rejects augment sources with incompatible atom counts", async () => {
    await expect(
      composeSources(
        [
          { id: "a", trajectory: new Trajectory([atoms(["C"])]) },
          { id: "b", trajectory: new Trajectory([atoms(["C", "O"])]) },
        ],
        0,
      ),
    ).rejects.toThrow(/atom count/);
  });

  it("takes coords from the trajectory and identity from the structure in either order", async () => {
    const traj = new Trajectory([atoms(["C", "O"], 0), atoms(["C", "O"], 10)]);
    const topo = atoms(["N", "H"], 0);
    topo.set("bonds", bonds([[0, 1]]).get("bonds"));
    const topology = new Trajectory([topo]);

    const expectComposed = async (
      sources: Parameters<typeof composeSources>[0],
    ) => {
      const out = await composeSources(sources, 1);
      expect(
        Array.from((out.get("atoms").copy("x") as Float64Array) ?? []),
      ).toEqual([10, 11]);
      expect([...(out.get("atoms").copy("element") as string[])]).toEqual([
        "N",
        "H",
      ]);
      expect(out.get("bonds").nRows).toBe(1);
    };

    await expectComposed([
      { id: "topo", trajectory: topology },
      { id: "traj", trajectory: traj },
    ]);
    await expectComposed([
      { id: "traj", trajectory: traj },
      { id: "topo", trajectory: topology },
    ]);
  });

  it("scatters DCD coords onto LAMMPS data rows by atom id, not file order", async () => {
    // data file order: ids 3,1,2 — bonds index *rows*. DCD is id order 1,2,3.
    const topo = atoms(["C", "N", "O"], 0);
    setAtomU32(topo, "id", [3, 1, 2]);
    topo.set("bonds", bonds([[0, 1]]).get("bonds"));
    const topology = new Trajectory([topo]);

    const frame0 = atoms(["X", "X", "X"], 0);
    setAtomU32(frame0, "id", [1, 2, 3]);
    setAtomF(frame0, "x", [10, 20, 30]);
    const frame1 = atoms(["X", "X", "X"], 0);
    setAtomU32(frame1, "id", [1, 2, 3]);
    setAtomF(frame1, "x", [11, 21, 31]);
    const traj = new Trajectory([frame0, frame1]);

    const expectComposed = async (
      sources: Parameters<typeof composeSources>[0],
    ) => {
      const out = await composeSources(sources, 1);
      expect(
        Array.from(
          (out.get("atoms").copy("id") as BigUint64Array) ?? [],
          Number,
        ),
      ).toEqual([3, 1, 2]);
      expect(
        Array.from((out.get("atoms").copy("x") as Float64Array) ?? []),
      ).toEqual([31, 11, 21]);
      expect([...(out.get("atoms").copy("element") as string[])]).toEqual([
        "C",
        "N",
        "O",
      ]);
      expect(
        Array.from(
          (out.get("bonds").copy("atomi") as BigUint64Array) ?? [],
          Number,
        ),
      ).toEqual([0]);
      expect(
        Array.from(
          (out.get("bonds").copy("atomj") as BigUint64Array) ?? [],
          Number,
        ),
      ).toEqual([1]);
    };

    await expectComposed([
      { id: "topo", trajectory: topology },
      { id: "traj", trajectory: traj },
    ]);
    await expectComposed([
      { id: "traj", trajectory: traj },
      { id: "topo", trajectory: topology },
    ]);
  });

  it("rejects unequal multi-frame source lengths", async () => {
    await expect(
      composeSources(
        [
          { id: "a", trajectory: new Trajectory([atoms(["C"]), atoms(["C"])]) },
          {
            id: "b",
            trajectory: new Trajectory([
              atoms(["C"]),
              atoms(["C"]),
              atoms(["C"]),
            ]),
          },
        ],
        0,
      ),
    ).rejects.toThrow(/timeline/);
  });
});

describe("compatibleAugmentLengths", () => {
  it("lets a trajectory stack onto a length-1 structure and the reverse", () => {
    expect(compatibleAugmentLengths(1, 3001)).toBe(true);
    expect(compatibleAugmentLengths(3001, 1)).toBe(true);
    expect(compatibleAugmentLengths(undefined, 3001)).toBe(true);
    expect(compatibleAugmentLengths(3001, 3001)).toBe(true);
    expect(compatibleAugmentLengths(3001, 100)).toBe(false);
  });
});

describe("loader-time extend", () => {
  it("concatenates atoms, offsets bonds, and writes source_id", () => {
    const a = atoms(["C", "O"], 0);
    a.set("bonds", bonds([[0, 1]]).get("bonds"));
    const b = atoms(["H"], 5);
    setAtomStr(b, "resname", ["LIG"]);
    b.set("bonds", bonds([[0, 0]]).get("bonds"));

    const out = extendFrames([a, b]);
    const atomsBlock = out.has("atoms") ? out.get("atoms") : undefined;
    const bondsBlock = out.has("bonds") ? out.get("bonds") : undefined;

    expect(atomsBlock?.nRows).toBe(3);
    expect(
      Array.from((atomsBlock?.copy("source_id") as Int32Array) ?? []),
    ).toEqual([0, 0, 1]);
    expect(
      Array.from((bondsBlock?.copy("atomi") as BigUint64Array) ?? [], Number),
    ).toEqual([0, 2]);
    expect(
      Array.from((bondsBlock?.copy("atomj") as BigUint64Array) ?? [], Number),
    ).toEqual([1, 2]);
    expect([...(atomsBlock?.copy("resname") as string[])]).toEqual([
      "",
      "",
      "LIG",
    ]);
  });

  it("copies source WASM handles instead of consuming them", async () => {
    const a = atoms(["C"], 0);
    a.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    const b = atoms(["O"], 5);

    const projected = await composeSources(
      [{ id: "a", trajectory: new Trajectory([a]) }],
      0,
    );
    const extended = extendFrames([a, b]);

    expect(a.get("atoms").nRows).toBe(1);
    expect(projected.get("atoms").nRows).toBe(1);
    expect(extended.get("atoms").nRows).toBe(2);

    const sourceBox = a.box;
    const projectedBox = projected.box;
    const extendedBox = extended.box;
    try {
      expect(sourceBox?.volume()).toBe(1000);
      expect(projectedBox?.volume()).toBe(1000);
      expect(extendedBox?.volume()).toBe(1000);
    } finally {
      sourceBox?.free();
      projectedBox?.free();
      extendedBox?.free();
    }
  });
});
