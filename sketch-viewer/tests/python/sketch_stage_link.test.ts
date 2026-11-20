import type { MoleculeData } from "@molcrafts/molvis-sketch";
import { describe, expect, it } from "@rstest/core";
import {
  type LinkState,
  type MoleculeEndpoint,
  SketchStageLink,
} from "../../src/python/sketch_stage_link";

const carbon = (): MoleculeData => ({
  atoms: [{ element: "C", x: 0, y: 0 }],
  bonds: [],
});

class Endpoint implements MoleculeEndpoint {
  data = carbon();
  writes: MoleculeData[] = [];
  listeners = new Set<() => void>();
  beforeWrite: (() => Promise<void>) | null = null;
  error: Error | null = null;
  read(): MoleculeData {
    return structuredClone(this.data);
  }
  async write(data: MoleculeData): Promise<void> {
    if (this.beforeWrite) await this.beforeWrite();
    if (this.error) throw this.error;
    this.writes.push(structuredClone(data));
    this.change(data);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }
  change(data: MoleculeData): void {
    this.data = structuredClone(data);
    for (const listener of this.listeners) listener();
  }
}

describe("SketchStageLink", () => {
  it("clears an embedding error when undo returns to the last synchronized molecule", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    const states: LinkState[] = [];
    const link = new SketchStageLink(sketch, stage, (state) =>
      states.push(state),
    );
    await link.start();
    stage.error = new Error("Invalid valence");
    sketch.change({
      atoms: [{ element: "N", x: 0, y: 0, charge: 9 }],
      bonds: [],
    });
    await link.syncFrom("sketch");
    expect(states.at(-1)?.kind).toBe("error");
    sketch.change(carbon());
    await link.syncFrom("sketch");
    expect(states.at(-1)).toEqual({ kind: "ready" });
    expect(stage.writes).toHaveLength(1);
    await link.stop();
  });
  it("keeps a restored 3D conformation instead of embedding it again", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    stage.data = { atoms: [{ element: "C", x: 31, y: 23 }], bonds: [] };
    const link = new SketchStageLink(sketch, stage, () => {});
    await link.start(sketch.data);
    expect(stage.writes).toHaveLength(0);
    expect(stage.data.atoms[0].x).toBe(31);
    await link.stop();
  });
  it("does nothing until started and initializes 3D from the drawing once", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    const link = new SketchStageLink(sketch, stage, () => {});
    expect(stage.writes).toEqual([]);
    await link.start();
    expect(stage.writes).toEqual([carbon()]);
    expect(sketch.writes).toEqual([]);
    await link.stop();
  });

  it("propagates atom, charge and bond edits in either direction without echoes", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    const link = new SketchStageLink(sketch, stage, () => {});
    await link.start();
    const amine: MoleculeData = {
      atoms: [{ element: "N", x: 0, y: 0, charge: 1 }],
      bonds: [],
    };
    sketch.change(amine);
    await link.syncFrom("sketch");
    expect(stage.data).toEqual(amine);
    const bonded: MoleculeData = {
      atoms: [...amine.atoms, { element: "O", x: 1, y: 1 }],
      bonds: [{ i: 0, j: 1, order: 2 }],
    };
    stage.change(bonded);
    await link.syncFrom("stage");
    expect(sketch.data).toEqual(bonded);
    expect(sketch.writes).toHaveLength(1);
    expect(stage.writes).toHaveLength(2);
    await link.stop();
  });

  it("does not replace either geometry for layout, color, selection or camera notifications", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    const link = new SketchStageLink(sketch, stage, () => {});
    await link.start();
    sketch.change({
      atoms: [{ element: "C", x: 20, y: 12, color: "#ff0000" }],
      bonds: [],
    });
    await link.syncFrom("sketch");
    stage.change({ atoms: [{ element: "C", x: 5, y: 8 }], bonds: [] });
    await link.syncFrom("stage");
    expect(stage.writes).toHaveLength(1);
    expect(sketch.writes).toHaveLength(0);
    await link.stop();
  });

  it("applies the newest drawing when it changes during an asynchronous update", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    stage.beforeWrite = () => waiting;
    const link = new SketchStageLink(sketch, stage, () => {});
    const running = link.start();
    await Promise.resolve();
    sketch.change({ atoms: [{ element: "O", x: 0, y: 0 }], bonds: [] });
    release();
    await running;
    expect(stage.data.atoms[0].element).toBe("O");
    await link.stop();
  });

  it("keeps the drawing intact on failure and permits a retry", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    const states: LinkState[] = [];
    stage.error = new Error("Invalid valence");
    const link = new SketchStageLink(sketch, stage, (state) =>
      states.push(state),
    );
    await link.start();
    expect(states.at(-1)).toEqual({
      kind: "error",
      source: "sketch",
      message: "Invalid valence",
    });
    expect(sketch.data).toEqual(carbon());
    stage.error = null;
    await link.syncFrom("sketch");
    expect(states.at(-1)).toEqual({ kind: "ready" });
    await link.stop();
  });

  it("unsubscribes immediately and waits for an in-flight write before teardown", async () => {
    const sketch = new Endpoint();
    const stage = new Endpoint();
    let release: () => void = () => {};
    stage.beforeWrite = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const states: LinkState[] = [];
    const link = new SketchStageLink(sketch, stage, (state) =>
      states.push(state),
    );
    const running = link.start();
    await Promise.resolve();
    const stopped = link.stop();
    expect(sketch.listeners.size).toBe(0);
    expect(stage.listeners.size).toBe(0);
    release();
    await Promise.all([running, stopped]);
    expect(states.some((state) => state.kind === "ready")).toBe(false);
    sketch.change({ atoms: [], bonds: [] });
    expect(stage.writes).toHaveLength(1);
  });
});
