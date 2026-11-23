import type { MoleculeData } from "@molcrafts/molvis-sketch";

export interface MoleculeEndpoint {
  read(): MoleculeData | Promise<MoleculeData>;
  write(data: MoleculeData): void | Promise<void>;
  subscribe(listener: () => void): () => void;
}

export type LinkSide = "sketch" | "stage";
export type LinkState =
  | { kind: "syncing"; target: LinkSide }
  | { kind: "ready" }
  | { kind: "error"; message: string; source: LinkSide };

/** Serializes chemical edits between two views without echoing their writes. */
export class SketchStageLink {
  private active = false;
  private writing: LinkSide | null = null;
  private pending: LinkSide | null = null;
  private task: Promise<void> | null = null;
  private topology: string | null = null;
  private unsubscribe: Array<() => void> = [];

  constructor(
    private readonly sketch: MoleculeEndpoint,
    private readonly stage: MoleculeEndpoint,
    private readonly onState: (state: LinkState) => void,
  ) {}

  start(alreadySynced?: MoleculeData): Promise<void> {
    if (this.active) return this.task ?? Promise.resolve();
    if (alreadySynced)
      this.topology = SketchStageLink.topologyOf(alreadySynced);
    this.unsubscribe = [
      this.sketch.subscribe(() => void this.syncFrom("sketch")),
      this.stage.subscribe(() => void this.syncFrom("stage")),
    ];
    this.active = true;
    if (alreadySynced) this.onState({ kind: "ready" });
    return this.syncFrom("sketch");
  }

  /** Also serves as an explicit retry after a failed update. */
  syncFrom(source: LinkSide): Promise<void> {
    if (!this.active || this.writing === source) {
      return Promise.resolve();
    }
    this.pending = source;
    if (!this.task) {
      this.task = this.flush().finally(() => {
        this.task = null;
        if (this.active && this.pending) void this.syncFrom(this.pending);
      });
    }
    return this.task;
  }

  /** Stop notifications immediately; let an already-started write settle. */
  stop(): Promise<void> {
    this.active = false;
    this.pending = null;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    return this.task ?? Promise.resolve();
  }

  private async flush(): Promise<void> {
    while (this.active && this.pending) {
      const source = this.pending;
      this.pending = null;
      const target = source === "sketch" ? "stage" : "sketch";
      try {
        const data = await this[source].read();
        if (!this.active) return;
        const topology = SketchStageLink.topologyOf(data);
        if (topology === this.topology) {
          this.onState({ kind: "ready" });
          continue;
        }
        this.onState({ kind: "syncing", target });
        this.writing = target;
        await this[target].write(data);
        if (!this.active) return;
        this.topology = topology;
        this.onState({ kind: "ready" });
      } catch (error) {
        if (this.active) {
          this.onState({
            kind: "error",
            source,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        this.writing = null;
      }
    }
  }

  /** Depiction coordinates and colors do not change molecular connectivity. */
  static topologyOf(data: MoleculeData): string {
    return JSON.stringify({
      atoms: data.atoms.map((atom) => [
        atom.element,
        atom.charge ?? 0,
        atom.hydrogens ?? 0,
        atom.port ?? "",
      ]),
      bonds: data.bonds.map((bond) => [
        bond.i,
        bond.j,
        bond.order,
        bond.stereo ?? "none",
      ]),
    });
  }
}
