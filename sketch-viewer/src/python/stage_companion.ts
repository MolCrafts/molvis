import { type MoleculeData, MoleculeGraph } from "@molcrafts/molvis-sketch";
import {
  Conformer,
  type Frame,
  ModeType,
  Molvis,
  Trajectory,
} from "@molcrafts/molvis-stage";
import type { MoleculeEndpoint } from "./sketch_stage_link";

/** Owns an exported Frame until a Stage consumes it or its owner frees it. */
export interface StageCompanionSnapshot {
  frame: Frame;
  atomIds: number[];
  depictionIds: number[];
}

/** Lazy-loaded 3D editor; all scene data enters through Stage's source path. */
export class StageCompanion implements MoleculeEndpoint {
  readonly app: Molvis;
  private depictionIds: number[] = [];
  private restoring: StageCompanionSnapshot | null;

  constructor(
    host: HTMLElement,
    private readonly drawing: () => MoleculeData,
    saved: StageCompanionSnapshot | null = null,
  ) {
    this.app = new Molvis(host, {
      gui: true,
      ui: {
        showInfoPanel: false,
        showModePanel: true,
        showViewPanel: false,
        showPerfPanel: false,
        showTrajPanel: false,
        showContextMenu: true,
      },
    });
    this.restoring = saved;
  }

  async start(): Promise<void> {
    await this.app.start();
    if (this.restoring) {
      const saved = this.restoring;
      this.restoring = null;
      await this.app.replaceScene(new Trajectory([saved.frame]));
      const probe = await this.capture();
      try {
        this.depictionIds = saved.depictionIds.map(
          (id) => probe.atomIds[saved.atomIds.indexOf(id)] ?? -1,
        );
      } finally {
        probe.frame.free();
      }
      this.app.world.fit();
    }
    this.app.setMode(ModeType.Edit);
  }

  async write(data: MoleculeData): Promise<void> {
    // Sketch's wedge notation has no chiral-reference Frame export yet.
    // Do not show an arbitrary stereoisomer as a synchronized 3D structure.
    if (
      data.bonds.some((bond) => bond.stereo === "up" || bond.stereo === "down")
    ) {
      throw new Error(
        "Wedge-bond stereochemistry is not supported in linked 3D yet. Your 2D drawing is preserved.",
      );
    }
    const graph = new MoleculeGraph();
    graph.loadMoleculeData(data);
    const input = graph.toFrame();
    let frame: Frame;
    try {
      if (data.atoms.length === 0) {
        frame = input;
      } else {
        const conformer = new Conformer(false, 0, 42);
        try {
          frame = conformer.generate(input);
        } finally {
          conformer.free();
        }
      }
    } finally {
      if (data.atoms.length > 0) input.free();
    }
    await this.app.replaceScene(new Trajectory([frame]));
    const probe = await this.capture();
    this.depictionIds = probe.atomIds;
    probe.frame.free();
    this.app.world.fit();
  }

  async read(): Promise<MoleculeData> {
    const { frame, atomIds } = await this.capture();
    try {
      const graph = new MoleculeGraph();
      graph.fromFrame(frame);
      const data = graph.getMoleculeData();
      // Read the current drawing, not the last generated source: layout and
      // color edits intentionally do not rebuild the 3D conformation.
      const depiction = this.drawing();
      const previousRows = atomIds.map((id) => this.depictionIds.indexOf(id));
      data.atoms = data.atoms.map((atom, index) => {
        const original = depiction.atoms[previousRows[index]];
        if (!original) return atom;
        // Keep the entire fresh depiction coherent. Mixing old survivor x/y
        // with freshly laid-out additions can create long crossing bonds.
        return {
          ...atom,
          color: original.color,
          port: original.port,
          hydrogens:
            original.element === atom.element &&
            (original.charge ?? 0) === (atom.charge ?? 0)
              ? original.hydrogens
              : atom.hydrogens,
        };
      });
      data.bonds = data.bonds.map((bond) => {
        const i = previousRows[bond.i];
        const j = previousRows[bond.j];
        const original = depiction.bonds.find(
          (candidate) =>
            candidate.order === bond.order &&
            ((candidate.i === i && candidate.j === j) ||
              (candidate.i === j && candidate.j === i)),
        );
        return original
          ? {
              ...bond,
              i: i === original.i ? bond.i : bond.j,
              j: i === original.i ? bond.j : bond.i,
              stereo: original.stereo,
              color: original.color,
            }
          : bond;
      });
      this.depictionIds = atomIds;
      return data;
    } finally {
      frame.free();
    }
  }

  subscribe(listener: () => void): () => void {
    return this.app.events.on("history-change", listener);
  }

  /** Preserve edited 3D geometry while the pane's GPU resources are closed. */
  async capture(): Promise<StageCompanionSnapshot> {
    const { frame, atomIds } = await this.app.execute<
      Record<string, never>,
      { frame: Frame; atomIds: number[] }
    >("export_frame", {});
    return { frame, atomIds, depictionIds: this.depictionIds.slice() };
  }

  destroy(): void {
    this.restoring?.frame.free();
    this.restoring = null;
    this.app.destroy();
  }
}
