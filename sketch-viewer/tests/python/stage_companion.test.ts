import type { MoleculeData } from "@molcrafts/molvis-sketch";
import { beforeEach, describe, expect, it, rstest } from "@rstest/core";
import { StageCompanion } from "../../src/python/stage_companion";

const fake = rstest.hoisted(() => {
  class Frame {
    freed = false;
    ids: BigUint64Array = new BigUint64Array();
    constructor(public data: MoleculeData = { atoms: [], bonds: [] }) {}
    free(): void {
      this.freed = true;
    }
    has(): boolean {
      return this.data.atoms.length > 0;
    }
    get() {
      return {
        set: (_key: string, ids: BigUint64Array) => {
          this.ids = ids;
        },
        has: () => this.ids.length > 0,
        copy: () => this.ids,
      };
    }
    clone(): Frame {
      const frame = new Frame(structuredClone(this.data));
      frame.ids = this.ids.slice();
      return frame;
    }
  }
  const generated: Frame[] = [];
  let invalid = false;
  class Molvis {
    static latest: Molvis;
    frame = new Frame();
    exports: Frame[] = [];
    calls: string[] = [];
    mode = "";
    world = { fit: () => {} };
    events = { on: () => () => {} };
    constructor() {
      Molvis.latest = this;
    }
    async start(): Promise<void> {}
    setMode(mode: string): void {
      this.mode = mode;
    }
    async replaceScene(trajectory: { frames: Frame[] }): Promise<void> {
      this.calls.push("replaceScene");
      this.frame = trajectory.frames[0];
      this.frame.ids = BigUint64Array.from(this.frame.data.atoms, (_, index) =>
        BigInt(index),
      );
    }
    execute(name: string): { frame: Frame; atomIds: number[] } {
      this.calls.push(name);
      const frame = this.frame.clone();
      this.exports.push(frame);
      return { frame, atomIds: Array.from(frame.ids, Number) };
    }
    destroy(): void {
      this.frame.free();
    }
  }
  class Graph {
    data: MoleculeData = { atoms: [], bonds: [] };
    loadMoleculeData(data: MoleculeData): void {
      this.data = structuredClone(data);
    }
    getMoleculeData(): MoleculeData {
      return structuredClone(this.data);
    }
    toFrame(): Frame {
      const frame = new Frame(this.getMoleculeData());
      generated.push(frame);
      return frame;
    }
    fromFrame(frame: Frame): void {
      this.loadMoleculeData(frame.data);
    }
  }
  class Conformer {
    generate(frame: Frame): Frame {
      if (invalid) throw new Error("Invalid valence");
      return frame.clone();
    }
    free(): void {}
  }
  class Trajectory {
    constructor(public frames: Frame[]) {}
  }
  return {
    Frame,
    Molvis,
    Graph,
    Conformer,
    Trajectory,
    generated,
    invalid: (value: boolean) => {
      invalid = value;
    },
  };
});

rstest.mock("@molcrafts/molvis-sketch", () => ({ MoleculeGraph: fake.Graph }));
rstest.mock("@molcrafts/molvis-stage", () => ({
  Molvis: fake.Molvis,
  Conformer: fake.Conformer,
  Trajectory: fake.Trajectory,
  ModeType: { Edit: "edit" },
}));

const molecule: MoleculeData = {
  atoms: [
    { element: "C", x: 10, y: 20 },
    { element: "N", x: 30, y: 40, charge: 1, hydrogens: 3 },
  ],
  bonds: [{ i: 0, j: 1, order: 1, color: "#123456" }],
};

beforeEach(() => {
  fake.invalid(false);
  fake.generated.length = 0;
});

describe("StageCompanion", () => {
  it("uses current drawing colors and one coherent fresh layout for newly bonded atoms", async () => {
    const drawing = structuredClone(molecule);
    const companion = new StageCompanion({} as HTMLElement, () => drawing);
    await companion.write(drawing);
    drawing.atoms[0] = {
      ...drawing.atoms[0],
      x: 10000,
      y: 10000,
      color: "#ff0000",
    };
    drawing.bonds[0].color = "#00ff00";
    const stage = fake.Molvis.latest;
    stage.frame.data = {
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "N", x: 1.5, y: 0, charge: 1 },
        { element: "O", x: 3, y: 0 },
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },
        { i: 1, j: 2, order: 1 },
      ],
    };
    stage.frame.ids = new BigUint64Array([0n, 1n, 5n]);
    const result = await companion.read();
    expect(result.atoms.map((atom) => [atom.x, atom.y])).toEqual([
      [0, 0],
      [1.5, 0],
      [3, 0],
    ]);
    expect(result.atoms[0].color).toBe("#ff0000");
    expect(result.bonds[0].color).toBe("#00ff00");
    companion.destroy();
  });
  it("does not silently discard wedge stereochemistry when generating 3D", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    const stereo = structuredClone(molecule);
    stereo.bonds[0].stereo = "up";
    await expect(companion.write(stereo)).rejects.toThrow(
      "Wedge-bond stereochemistry",
    );
    expect(fake.Molvis.latest.calls).toEqual([]);
    companion.destroy();
  });
  it("uses Stage's source ingress and starts in an editable mode", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    await companion.start();
    await companion.write(molecule);
    expect(fake.Molvis.latest.mode).toBe("edit");
    expect(fake.Molvis.latest.calls).toEqual(["replaceScene", "export_frame"]);
    expect(fake.Molvis.latest.frame.data).toEqual(molecule);
    expect(Array.from(fake.Molvis.latest.frame.ids)).toEqual([0n, 1n]);
    expect(fake.generated[0].freed).toBe(true);
    companion.destroy();
  });

  it("exports staged edits without committing and preserves 2D depiction metadata", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    await companion.write(molecule);
    const stage = fake.Molvis.latest;
    stage.frame.data.atoms[0].x = 99;
    stage.frame.data.atoms[1].charge = 2;
    stage.frame.data.bonds[0].color = undefined;
    const data = await companion.read();
    expect(data.atoms[0].x).toBe(99);
    expect(data.atoms[1].charge).toBe(2);
    expect(data.bonds[0].color).toBe("#123456");
    expect(stage.calls).toEqual([
      "replaceScene",
      "export_frame",
      "export_frame",
    ]);
    expect(stage.exports[0].freed).toBe(true);
    companion.destroy();
  });

  it("uses stable source ids after a 3D deletion and keeps newly added atoms", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    await companion.write(molecule);
    const stage = fake.Molvis.latest;
    stage.frame.data = {
      atoms: [
        { element: "N", x: 5, y: 6, charge: 1 },
        { element: "O", x: 7, y: 8 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    };
    stage.frame.ids = new BigUint64Array([1n, 7n]);
    const data = await companion.read();
    expect(data.atoms[0]).toEqual({
      ...molecule.atoms[1],
      x: 5,
      y: 6,
      color: undefined,
      port: undefined,
    });
    expect(data.atoms[1]).toEqual({ element: "O", x: 7, y: 8 });
    expect(data.bonds).toEqual([{ i: 0, j: 1, order: 1 }]);
    companion.destroy();
  });

  it("retains the existing scene if embedding fails and releases its input frame", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    await companion.write(molecule);
    const before = fake.Molvis.latest.frame;
    fake.invalid(true);
    await expect(companion.write(molecule)).rejects.toThrow("Invalid valence");
    expect(fake.Molvis.latest.frame).toBe(before);
    expect(fake.generated.at(-1)?.freed).toBe(true);
    companion.destroy();
  });

  it("retains a captured conformation across closing and reopening without regenerating it", async () => {
    const companion = new StageCompanion({} as HTMLElement, () => molecule);
    await companion.write(molecule);
    fake.Molvis.latest.frame.data.atoms[0].x = 77;
    const saved = await companion.capture();
    companion.destroy();
    expect(
      (saved.frame as unknown as InstanceType<typeof fake.Frame>).freed,
    ).toBe(false);
    const restored = new StageCompanion(
      {} as HTMLElement,
      () => molecule,
      saved,
    );
    await restored.start();
    expect(fake.Molvis.latest.frame.data.atoms[0].x).toBe(77);
    expect(fake.generated).toHaveLength(1);
    restored.destroy();
    expect(
      (saved.frame as unknown as InstanceType<typeof fake.Frame>).freed,
    ).toBe(true);
  });
});
