import type { FragmentTemplate } from "../geometry/fragment_templates";
import { DEFAULT_BOND_LENGTH } from "../geometry/snap";
import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { Atom2D, MoleculeData } from "../types";

export interface PlaceFragmentOptions {
  /** Document point for free placement (root lands here). */
  x: number;
  y: number;
  /**
   * When set with attachMode `merge` or `bond`, attach to this existing atom.
   * For free placement leave undefined.
   */
  targetAtom?: number;
  /**
   * Direction from target → root for `bond` attach (unit vector).
   * Defaults to +x when omitted.
   */
  bondDir?: { x: number; y: number };
  color?: string;
}

/**
 * Insert a fragment template as one undo step.
 *
 * Free place: translate so root is at (x, y).
 * Merge attach: root coincides with target; root atom is not duplicated.
 * Bond attach: root is placed one bond-length from target along `bondDir`.
 */
export class PlaceFragmentCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly template: FragmentTemplate,
    private readonly options: PlaceFragmentOptions,
  ) {
    super();
  }

  do(): void {
    this.before = this.graph.getMoleculeData();
    const { data, rootIndex, attachMode } = this.template;
    if (rootIndex < 0 || rootIndex >= data.atoms.length) {
      throw new Error(`fragment rootIndex out of range: ${rootIndex}`);
    }

    const root = data.atoms[rootIndex];
    const targetAtom = this.options.targetAtom;
    const color = this.options.color;

    let dx: number;
    let dy: number;
    let skipRoot = false;
    let mergeTarget: number | null = null;

    if (targetAtom !== undefined && attachMode === "merge") {
      const target = this.graph.getAtom(targetAtom);
      dx = target.x - root.x;
      dy = target.y - root.y;
      skipRoot = true;
      mergeTarget = targetAtom;
    } else if (targetAtom !== undefined && attachMode === "bond") {
      const target = this.graph.getAtom(targetAtom);
      const dir = this.options.bondDir ?? { x: 1, y: 0 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const ux = dir.x / len;
      const uy = dir.y / len;
      const rootX = target.x + ux * DEFAULT_BOND_LENGTH;
      const rootY = target.y + uy * DEFAULT_BOND_LENGTH;
      dx = rootX - root.x;
      dy = rootY - root.y;
    } else {
      dx = this.options.x - root.x;
      dy = this.options.y - root.y;
    }

    const indexMap: number[] = new Array(data.atoms.length);
    for (let i = 0; i < data.atoms.length; i++) {
      if (skipRoot && i === rootIndex && mergeTarget !== null) {
        indexMap[i] = mergeTarget;
        continue;
      }
      const atom = data.atoms[i];
      const placed: Atom2D = {
        element: atom.element,
        x: atom.x + dx,
        y: atom.y + dy,
        ...(atom.charge !== undefined ? { charge: atom.charge } : {}),
        ...(color
          ? { color }
          : atom.color !== undefined
            ? { color: atom.color }
            : {}),
      };
      indexMap[i] = this.graph.addAtomInternal(placed);
    }

    if (targetAtom !== undefined && attachMode === "bond") {
      const rootNew = indexMap[rootIndex];
      if (this.graph.findBondIndex(targetAtom, rootNew) === null) {
        this.graph.addBondInternal({
          i: targetAtom,
          j: rootNew,
          order: 1,
          ...(color ? { color } : {}),
        });
      }
    }

    for (const bond of data.bonds) {
      const i = indexMap[bond.i];
      const j = indexMap[bond.j];
      if (i === j) continue;
      if (this.graph.findBondIndex(i, j) !== null) continue;
      this.graph.addBondInternal({
        i,
        j,
        order: bond.order,
        ...(bond.stereo !== undefined ? { stereo: bond.stereo } : {}),
        ...(color
          ? { color }
          : bond.color !== undefined
            ? { color: bond.color }
            : {}),
      });
    }
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}
