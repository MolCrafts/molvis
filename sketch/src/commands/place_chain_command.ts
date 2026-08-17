import { buildChainPoints } from "../geometry/chain_builder";
import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { MoleculeData } from "../types";

const CHAIN_POINT_EPSILON = 1e-8;

/**
 * Place a carbon chain from atom `startIndex` toward (endX, endY)
 * as a fixed-length zig-zag with 120° internal angles.
 */
export class PlaceChainCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly startIndex: number,
    private readonly endX: number,
    private readonly endY: number,
    private readonly step: number,
    private readonly order: number,
    private readonly color?: string,
  ) {
    super();
  }

  do(): void {
    validateChainPlacement(this.step, this.order);
    const start = this.graph.getAtom(this.startIndex);
    const { points } = buildChainPoints(
      start.x,
      start.y,
      this.endX,
      this.endY,
      this.step,
    );
    if (points.length < 2) return;
    this.before = this.graph.getMoleculeData();
    placeChainPoints(this.graph, this.startIndex, points, this.color);
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}

/**
 * Place a carbon chain whose first atom is created on empty paper.
 * The start atom and all segments are one reversible history entry.
 */
export class PlaceChainFromPointCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly startX: number,
    private readonly startY: number,
    private readonly endX: number,
    private readonly endY: number,
    private readonly step: number,
    private readonly order: number,
    private readonly color?: string,
  ) {
    super();
  }

  do(): void {
    validateChainPlacement(this.step, this.order);
    const { points } = buildChainPoints(
      this.startX,
      this.startY,
      this.endX,
      this.endY,
      this.step,
    );
    if (points.length < 2) return;
    this.before = this.graph.getMoleculeData();
    const startIndex =
      findCanonicalAtom(this.graph, this.startX, this.startY) ??
      this.graph.addAtomInternal({
        element: "C",
        x: this.startX,
        y: this.startY,
        ...(this.color ? { color: this.color } : {}),
      });
    placeChainPoints(this.graph, startIndex, points, this.color);
  }

  undo(): void {
    if (!this.before) return;
    this.graph.replaceAll(this.before);
    this.before = null;
  }
}

function placeChainPoints(
  graph: MoleculeGraph,
  startIndex: number,
  points: ReadonlyArray<{ x: number; y: number }>,
  color?: string,
): void {
  let previous = startIndex;
  for (const point of points) {
    const snap = findCanonicalAtom(graph, point.x, point.y);
    const canReuse =
      snap !== null &&
      snap !== previous &&
      graph.findBondIndex(previous, snap) === null;
    const atomIndex =
      canReuse && snap !== null
        ? snap
        : graph.addAtomInternal({
            element: "C",
            x: point.x,
            y: point.y,
            ...(color ? { color } : {}),
          });
    if (
      previous !== atomIndex &&
      graph.findBondIndex(previous, atomIndex) === null
    ) {
      graph.addBondInternal({
        i: previous,
        j: atomIndex,
        order: 1,
        ...(color ? { color } : {}),
      });
    }
    previous = atomIndex;
  }
}

function findCanonicalAtom(
  graph: MoleculeGraph,
  x: number,
  y: number,
): number | null {
  for (let index = 0; index < graph.atomCount(); index++) {
    const atom = graph.getAtom(index);
    if (Math.hypot(atom.x - x, atom.y - y) <= CHAIN_POINT_EPSILON) {
      return index;
    }
  }
  return null;
}

function validateChainPlacement(step: number, order: number): void {
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("chain step must be a positive finite number");
  }
  if (order !== 1) {
    throw new Error(`chain bond order must be 1; got ${order}`);
  }
}
