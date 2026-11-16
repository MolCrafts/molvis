import type {
  MoleculeData,
  SketchBoard,
  SketchExportOptions,
  SketchTopology,
} from "@molcrafts/molvis-sketch";

/**
 * The board surface the Python driver reaches. A `SketchBoard` satisfies it;
 * tests pass a fake, so this module never needs the engine at runtime.
 */
export type RpcBoard = Pick<
  SketchBoard,
  | "drawAtom"
  | "drawBond"
  | "setFragmentTemplate"
  | "placeFragmentAt"
  | "setRingTemplate"
  | "placeRingAt"
  | "drawChain"
  | "clear"
  | "undo"
  | "redo"
  | "replaceSelectedAtoms"
  | "selectedAtomIndices"
  | "deleteSelection"
  | "getMoleculeData"
  | "loadMoleculeData"
  | "toSvg"
  | "toPng"
  | "fitToView"
  | "getState"
>;

/** Completes a topology with 2D coordinates (`MoleculeLayout`). */
export interface TopologyPlacer {
  place(topology: SketchTopology): MoleculeData;
}

/** One fragment template id and its category, as `fragment_templates` lists them. */
export interface TemplateEntry {
  id: string;
  category: string;
}

/** A JSON-RPC error with a code from the 2.0 spec. */
export class SketchRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type Params = Record<string, unknown>;
type Handler = (params: Params) => unknown | Promise<unknown>;

/**
 * `sketch.*` JSON-RPC methods for the Python `molvis.Sketch` driver, one per
 * board verb. Every handler validates its params and calls exactly one board
 * operation (two for the template setters, which select then place, as the
 * Python docstrings describe). Results are plain JSON.
 */
export class SketchBoardRpc {
  private readonly handlers: ReadonlyMap<string, Handler>;

  constructor(
    private readonly board: RpcBoard,
    private readonly placer: TopologyPlacer,
    private readonly templates: () => readonly TemplateEntry[],
  ) {
    this.handlers = new Map<string, Handler>([
      ["sketch.draw_atom", (p) => this.drawAtom(p)],
      ["sketch.draw_bond", (p) => this.drawBond(p)],
      ["sketch.draw_fragment", (p) => this.drawFragment(p)],
      ["sketch.draw_ring", (p) => this.drawRing(p)],
      ["sketch.draw_chain", (p) => this.drawChain(p)],
      ["sketch.clear", () => this.board.clear()],
      ["sketch.undo", () => this.board.undo()],
      ["sketch.redo", () => this.board.redo()],
      ["sketch.select_atoms", (p) => this.selectAtoms(p)],
      ["sketch.selected_atoms", () => this.board.selectedAtomIndices()],
      ["sketch.delete_selection", () => this.board.deleteSelection()],
      ["sketch.molecule", () => this.board.getMoleculeData()],
      ["sketch.load", (p) => this.load(p)],
      ["sketch.fragment_templates", () => this.listTemplates()],
      ["sketch.export_svg", (p) => this.board.toSvg(exportOptions(p))],
      ["sketch.export_png", (p) => this.exportPng(p)],
      ["sketch.fit", () => this.board.fitToView()],
      ["sketch.to_frame", () => this.toFrame()],
      ["sketch.state", () => this.board.getState()],
    ]);
  }

  /** Method names this table answers. */
  methods(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Run one request. Resolves to the JSON result (`null` for verbs without
   * one); rejects with {@link SketchRpcError} for an unknown method or bad
   * params, and with the board's own error when the board refuses.
   */
  async execute(method: string, params: unknown): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new SketchRpcError(METHOD_NOT_FOUND, `unknown method: ${method}`);
    }
    if (
      params !== undefined &&
      (typeof params !== "object" || params === null)
    ) {
      throw new SketchRpcError(
        INVALID_PARAMS,
        `${method}: params must be an object`,
      );
    }
    const result = await handler((params ?? {}) as Params);
    return result === undefined ? null : result;
  }

  private drawAtom(p: Params): number {
    const charge = optionalInteger(p, "charge") ?? 0;
    return this.board.drawAtom({
      element: requireString(p, "element"),
      x: requireNumber(p, "x"),
      y: requireNumber(p, "y"),
      ...(charge !== 0 ? { charge } : {}),
    });
  }

  private drawBond(p: Params): number {
    const stereo = optionalString(p, "stereo") ?? "none";
    if (stereo !== "none" && stereo !== "up" && stereo !== "down") {
      throw new SketchRpcError(
        INVALID_PARAMS,
        `stereo must be none, up or down`,
      );
    }
    return this.board.drawBond({
      i: requireInteger(p, "i"),
      j: requireInteger(p, "j"),
      order: optionalInteger(p, "order") ?? 1,
      ...(stereo !== "none" ? { stereo } : {}),
    });
  }

  private drawFragment(p: Params): void {
    this.board.setFragmentTemplate(requireString(p, "template_id"));
    this.board.placeFragmentAt(
      requireNumber(p, "x"),
      requireNumber(p, "y"),
      optionalInteger(p, "target"),
    );
  }

  private drawRing(p: Params): void {
    const kind = optionalString(p, "kind") ?? "benzene";
    if (kind !== "benzene" && kind !== "aliphatic") {
      throw new SketchRpcError(
        INVALID_PARAMS,
        `kind must be benzene or aliphatic`,
      );
    }
    this.board.setRingTemplate(optionalInteger(p, "size") ?? 6, kind);
    this.board.placeRingAt(requireNumber(p, "x"), requireNumber(p, "y"));
  }

  private drawChain(p: Params): void {
    this.board.drawChain(
      requireNumber(p, "x0"),
      requireNumber(p, "y0"),
      requireNumber(p, "x1"),
      requireNumber(p, "y1"),
      optionalInteger(p, "start"),
    );
  }

  private selectAtoms(p: Params): void {
    const ids = p.atom_ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
      throw new SketchRpcError(
        INVALID_PARAMS,
        "atom_ids must be a list of integers",
      );
    }
    this.board.replaceSelectedAtoms(ids as number[]);
  }

  /**
   * Replace the document. Atoms may omit `x`/`y`: then the whole molecule is
   * laid out (`MoleculeLayout`). The view is fitted to the result.
   */
  private load(p: Params): MoleculeData {
    const data = p.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as SketchTopology).atoms) ||
      !Array.isArray((data as SketchTopology).bonds)
    ) {
      throw new SketchRpcError(
        INVALID_PARAMS,
        "sketch.load needs data = {atoms: [...], bonds: [...]}",
      );
    }
    const placed = this.placer.place(data as SketchTopology);
    this.board.loadMoleculeData(placed);
    this.board.fitToView();
    return this.board.getMoleculeData();
  }

  private listTemplates(): TemplateEntry[] {
    return this.templates().map((t) => ({ id: t.id, category: t.category }));
  }

  private async exportPng(p: Params): Promise<{ data: string }> {
    const blob = await this.board.toPng(exportOptions(p));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return { data: `data:image/png;base64,${btoa(binary)}` };
  }

  /**
   * Topology as the `{blocks: {atoms, bonds}}` mapping `Stage.draw_frame`
   * accepts. No coordinates: the 2D picture is not a 3D structure.
   */
  private toFrame(): Record<string, unknown> {
    const data = this.board.getMoleculeData();
    const atoms = { element: data.atoms.map((a) => a.element) };
    if (data.bonds.length === 0) return { blocks: { atoms } };
    const orders = data.bonds.map((b) => b.order);
    return {
      blocks: {
        atoms,
        bonds: {
          atomi: data.bonds.map((b) => b.i),
          atomj: data.bonds.map((b) => b.j),
          bond_type: orders,
          bond_number: orders,
        },
      },
    };
  }
}

function exportOptions(p: Params): SketchExportOptions {
  const out: SketchExportOptions = {};
  const width = optionalInteger(p, "width");
  const height = optionalInteger(p, "height");
  const padding = optionalNumber(p, "padding");
  const pixelRatio = optionalNumber(p, "pixel_ratio");
  const background = optionalString(p, "background");
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  if (padding !== undefined) out.padding = padding;
  if (pixelRatio !== undefined) out.pixelRatio = pixelRatio;
  if (background !== undefined) out.background = background;
  return out;
}

function requireNumber(p: Params, key: string): number {
  const value = p[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SketchRpcError(
      INVALID_PARAMS,
      `'${key}' must be a finite number`,
    );
  }
  return value;
}

function requireInteger(p: Params, key: string): number {
  const value = requireNumber(p, key);
  if (!Number.isInteger(value)) {
    throw new SketchRpcError(INVALID_PARAMS, `'${key}' must be an integer`);
  }
  return value;
}

function requireString(p: Params, key: string): string {
  const value = p[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SketchRpcError(
      INVALID_PARAMS,
      `'${key}' must be a non-empty string`,
    );
  }
  return value;
}

function optionalNumber(p: Params, key: string): number | undefined {
  return p[key] === undefined || p[key] === null
    ? undefined
    : requireNumber(p, key);
}

function optionalInteger(p: Params, key: string): number | undefined {
  return p[key] === undefined || p[key] === null
    ? undefined
    : requireInteger(p, key);
}

function optionalString(p: Params, key: string): string | undefined {
  return p[key] === undefined || p[key] === null
    ? undefined
    : requireString(p, key);
}
