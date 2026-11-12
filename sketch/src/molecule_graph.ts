import { AtomSpecies, toDomainUint, toRowIndex } from "@molcrafts/molvis-core";
import {
  Block,
  type Column,
  Frame,
  fillAtomicNumbers,
} from "@molcrafts/molvis-core/molrs";
import { MoleculeLayout } from "./geometry/molecule_layout";
import { normalizeSketchColor } from "./style/custom_color";
import type { Atom2D, Bond2D, MoleculeData, TopologyAtom } from "./types";

function cloneAtom(a: Atom2D): Atom2D {
  return {
    element: a.element,
    x: a.x,
    y: a.y,
    ...(a.charge !== undefined ? { charge: a.charge } : {}),
    ...(a.color !== undefined ? { color: a.color } : {}),
    ...(a.hydrogens !== undefined ? { hydrogens: a.hydrogens } : {}),
    ...(a.port !== undefined ? { port: a.port } : {}),
  };
}

function cloneBond(b: Bond2D): Bond2D {
  return {
    i: b.i,
    j: b.j,
    order: b.order,
    ...(b.stereo !== undefined ? { stereo: b.stereo } : {}),
    ...(b.color !== undefined ? { color: b.color } : {}),
  };
}

type BondBlock = {
  has(name: string): boolean;
  copy(name: string): Column;
};

/** A numeric column (any int/float dtype) as plain numbers, or `null`. */
function readNumberCol(block: BondBlock, name: string): number[] | null {
  if (!block.has(name)) return null;
  const column = block.copy(name) as unknown;
  if (ArrayBuffer.isView(column)) {
    return Array.from(column as unknown as ArrayLike<number | bigint>, Number);
  }
  if (Array.isArray(column) && column.every((v) => typeof v !== "string")) {
    return column.map(Number);
  }
  return null;
}

/** A string column, or `null` when absent or not strings. */
function readStringCol(block: BondBlock, name: string): string[] | null {
  if (!block.has(name)) return null;
  const column = block.copy(name) as unknown;
  if (!Array.isArray(column)) return null;
  return column.map((value) => String(value));
}

/** Coordinate deviation below which a `z` column still counts as planar. */
const PLANAR_Z_TOLERANCE = 1e-6;

/**
 * 2D coordinates a frame already carries: `x`/`y` with no `z`, or a `z` that
 * is zero everywhere (a flat depiction). A 3D conformer is not 2D and yields
 * `null`, so the layout runs instead of projecting it.
 */
function readPlanarCoords(
  block: BondBlock,
): { x: number[]; y: number[] } | null {
  const x = readNumberCol(block, "x");
  const y = readNumberCol(block, "y");
  if (!x || !y || x.length !== y.length) return null;
  const z = readNumberCol(block, "z");
  if (z?.some((value) => Math.abs(value) > PLANAR_Z_TOLERANCE)) return null;
  if (![...x, ...y].every(Number.isFinite)) return null;
  return { x, y };
}

/**
 * Port descriptors keyed by anchor atom, from a molpy-style `ports` block
 * (`atomi` = anchor, `port_kind` = `<` / `>` / `$` …, `port_label`).
 */
function readPorts(frame: Frame, atomCount: number): Map<number, string> {
  const ports = new Map<number, string>();
  if (!frame.has("ports")) return ports;
  const block = frame.get("ports");
  const anchors = readU32Col(block, "atomi");
  if (!anchors) return ports;
  const kinds = readStringCol(block, "port_kind");
  const labels = readStringCol(block, "port_label");
  anchors.forEach((anchor, row) => {
    if (anchor >= atomCount) {
      throw new Error(
        `fromFrame: port anchor ${anchor} out of range for ${atomCount} atoms`,
      );
    }
    const text = `${kinds?.[row] ?? ""}${labels?.[row] ?? ""}` || "*";
    const previous = ports.get(anchor);
    ports.set(anchor, previous ? `${previous} ${text}` : text);
  });
  return ports;
}

/** A uint (u64) column as row indices, or `null` when it is absent. */
function readU32Col(block: BondBlock, name: string): number[] | null {
  if (!block.has(name)) return null;
  return Array.from(block.copy(name) as BigUint64Array, toRowIndex);
}

/**
 * Sketch topology stores integer Kekulé orders 1–3.
 * Frame columns are molrs bond_type + bond_number only.
 */
function clampSketchOrder(v: number): number {
  const n = Math.round(Number(v));
  if (n < 1) return 1;
  if (n > 3) return 3;
  return n;
}

function readBondOrders(block: BondBlock): number[] {
  const numbers = readU32Col(block, "bond_number");
  const types = readU32Col(block, "bond_type");
  if (numbers && numbers.length > 0) {
    return numbers.map((number, i) => {
      if (number > 0) return clampSketchOrder(number);
      const bt = types ? types[i] : 0;
      if (bt > 0 && bt < 4) return clampSketchOrder(bt);
      // Aromatic without Kekulé phase → double for sketch sticks.
      if (bt === 4) return 2;
      return 1;
    });
  }
  if (types && types.length > 0) {
    return types.map((bt) => {
      if (bt === 4) return 2;
      if (bt > 0 && bt < 4) return clampSketchOrder(bt);
      return 1;
    });
  }
  return [];
}

/**
 * 2D molecular graph: topology + document-Å coordinates.
 *
 * Frame IO: atoms.element (str); bonds.atomi/atomj (u64), bond_type +
 * bond_number (u64). Delete-atom policy: remove incident bonds and re-map
 * surviving bond endpoints to the post-deletion index space.
 */
export class MoleculeGraph {
  private atoms: Atom2D[] = [];
  private bonds: Bond2D[] = [];

  loadMoleculeData(data: MoleculeData): void {
    const atoms = data.atoms.map(cloneAtom);
    const bonds = data.bonds.map(cloneBond);
    this.validateData(atoms, bonds);
    // Commit only after the whole candidate validates. A rejected import must
    // never leave a half-loaded graph behind.
    this.atoms = atoms;
    this.bonds = bonds;
  }

  /**
   * Deep copy of current graph data. Mutating the return value does not affect the graph.
   */
  getMoleculeData(): MoleculeData {
    return {
      atoms: this.atoms.map(cloneAtom),
      bonds: this.bonds.map(cloneBond),
    };
  }

  atomCount(): number {
    return this.atoms.length;
  }

  bondCount(): number {
    return this.bonds.length;
  }

  /**
   * Export molrs Frame for `Conformer.generate`.
   * Columns: atoms.element (str); bonds.atomi/atomj (u64), bond_type +
   * bond_number (u64, sketch Kekulé 1–3). No x/y (the conformer embeds coords).
   */
  toFrame(): Frame {
    const frame = new Frame();
    const atomBlock = new Block();
    atomBlock.set(
      "element",
      this.atoms.map((a) => a.element),
    );
    frame.set("atoms", atomBlock);

    if (this.bonds.length > 0) {
      const bondBlock = new Block();
      const orderU32 = toDomainUint(this.bonds.map((b) => b.order));
      bondBlock.set("atomi", toDomainUint(this.bonds.map((b) => b.i)));
      bondBlock.set("atomj", toDomainUint(this.bonds.map((b) => b.j)));
      bondBlock.set("bond_type", orderU32);
      bondBlock.set("bond_number", orderU32);
      frame.set("bonds", bondBlock);
    }
    fillAtomicNumbers(frame);
    return frame;
  }

  /**
   * Import a Frame. Reads `formal_charge`, `h_count` (implicit hydrogens) and
   * a molpy `ports` block when present. Planar `x`/`y` (no `z`, or `z` all
   * zero) are used as the 2D picture; otherwise — no coordinates, or a 3D
   * conformer — {@link MoleculeLayout} computes a depiction.
   */
  fromFrame(frame: Frame): void {
    const atomBlock = frame.has("atoms") ? frame.get("atoms") : undefined;
    if (!atomBlock || atomBlock.nRows === 0) {
      this.atoms = [];
      this.bonds = [];
      return;
    }
    const species = new AtomSpecies(atomBlock);
    if (!species.has()) {
      throw new Error(
        "fromFrame: atoms need species (atomic_number or element)",
      );
    }
    const elements = species.symbols();
    const n = elements.length;
    const charges = readNumberCol(atomBlock, "formal_charge");
    const hydrogens = readNumberCol(atomBlock, "h_count");
    const coords = readPlanarCoords(atomBlock);
    const ports = readPorts(frame, n);
    const atoms: TopologyAtom[] = elements.map((element, idx) => {
      const charge = charges?.[idx] ?? 0;
      const hCount = hydrogens?.[idx] ?? 0;
      const port = ports.get(idx);
      return {
        element: element || "C",
        ...(coords ? { x: coords.x[idx], y: coords.y[idx] } : {}),
        ...(charge !== 0 ? { charge } : {}),
        ...(hCount > 0 ? { hydrogens: hCount } : {}),
        ...(port !== undefined ? { port } : {}),
      };
    });

    const bonds: Bond2D[] = [];
    const bondBlock = frame.has("bonds") ? frame.get("bonds") : undefined;
    if (bondBlock && bondBlock.nRows > 0) {
      const atomi =
        readU32Col(bondBlock, "atomi") ?? readU32Col(bondBlock, "i") ?? [];
      const atomj =
        readU32Col(bondBlock, "atomj") ?? readU32Col(bondBlock, "j") ?? [];
      const orders = readBondOrders(bondBlock);
      const m = bondBlock.nRows;
      for (let k = 0; k < m; k++) {
        const i = atomi[k] ?? 0;
        const j = atomj[k] ?? 0;
        if (i >= n || j >= n) {
          throw new Error(
            `fromFrame: bond endpoint out of range (${i}, ${j}) for ${n} atoms`,
          );
        }
        bonds.push({
          i,
          j,
          order: orders[k] ?? 1,
        });
      }
    }
    this.loadMoleculeData(new MoleculeLayout().place({ atoms, bonds }));
  }

  /** Internal: add atom; returns new index. */
  addAtomInternal(atom: Atom2D): number {
    this.validateAtom(atom, this.atoms.length);
    this.atoms.push(cloneAtom(atom));
    return this.atoms.length - 1;
  }

  /** Internal: remove atom at index; remap bonds. */
  removeAtomInternal(index: number): Atom2D {
    if (index < 0 || index >= this.atoms.length) {
      throw new Error(`removeAtom: index ${index} out of range`);
    }
    const [removed] = this.atoms.splice(index, 1);
    this.bonds = this.bonds
      .filter((b) => b.i !== index && b.j !== index)
      .map((b) => ({
        ...b,
        i: b.i > index ? b.i - 1 : b.i,
        j: b.j > index ? b.j - 1 : b.j,
      }));
    return removed;
  }

  addBondInternal(bond: Bond2D): number {
    this.validateBond(bond, this.atoms.length, this.bonds);
    this.bonds.push(cloneBond(bond));
    return this.bonds.length - 1;
  }

  removeBondInternal(index: number): Bond2D {
    if (index < 0 || index >= this.bonds.length) {
      throw new Error(`removeBond: index ${index} out of range`);
    }
    const [removed] = this.bonds.splice(index, 1);
    return removed;
  }

  getAtom(index: number): Atom2D {
    const a = this.atoms[index];
    if (!a) throw new Error(`getAtom: index ${index} out of range`);
    return cloneAtom(a);
  }

  getBond(index: number): Bond2D {
    const b = this.bonds[index];
    if (!b) throw new Error(`getBond: index ${index} out of range`);
    return cloneBond(b);
  }

  setAtomInternal(index: number, atom: Atom2D): void {
    if (index < 0 || index >= this.atoms.length) {
      throw new Error(`setAtom: index ${index} out of range`);
    }
    this.validateAtom(atom, index);
    this.atoms[index] = cloneAtom(atom);
  }

  setBondInternal(index: number, bond: Bond2D): void {
    if (index < 0 || index >= this.bonds.length) {
      throw new Error(`setBond: index ${index} out of range`);
    }
    this.validateBond(
      bond,
      this.atoms.length,
      this.bonds.filter((_, bondIndex) => bondIndex !== index),
    );
    this.bonds[index] = cloneBond(bond);
  }

  /** Return the index of an undirected bond, or null when no bond exists. */
  findBondIndex(i: number, j: number): number | null {
    this.assertBondEndpoint(i, this.atoms.length);
    this.assertBondEndpoint(j, this.atoms.length);
    const index = this.bonds.findIndex(
      (bond) =>
        (bond.i === i && bond.j === j) || (bond.i === j && bond.j === i),
    );
    return index >= 0 ? index : null;
  }

  /** Replace entire graph (used by clear/snapshot commands). */
  replaceAll(data: MoleculeData): void {
    this.loadMoleculeData(data);
  }

  private validateData(atoms: Atom2D[], bonds: Bond2D[]): void {
    for (let index = 0; index < atoms.length; index++) {
      this.validateAtom(atoms[index], index);
    }

    const accepted: Bond2D[] = [];
    for (const bond of bonds) {
      this.validateBond(bond, atoms.length, accepted);
      accepted.push(bond);
    }
  }

  private validateAtom(atom: Atom2D, index: number): void {
    if (typeof atom.element !== "string" || atom.element.trim().length === 0) {
      throw new Error(`atom ${index}: element must be a non-empty string`);
    }
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      throw new Error(`atom ${index}: coordinates must be finite`);
    }
    if (atom.charge !== undefined && !Number.isInteger(atom.charge)) {
      throw new Error(`atom ${index}: charge must be an integer`);
    }
    if (
      atom.hydrogens !== undefined &&
      (!Number.isInteger(atom.hydrogens) || atom.hydrogens < 0)
    ) {
      throw new Error(
        `atom ${index}: hydrogens must be a non-negative integer`,
      );
    }
    if (
      atom.port !== undefined &&
      (typeof atom.port !== "string" || atom.port.trim().length === 0)
    ) {
      throw new Error(`atom ${index}: port must be a non-empty string`);
    }
    this.validateColor(atom.color, `atom ${index}`);
  }

  private validateBond(
    bond: Bond2D,
    atomCount: number,
    existing: readonly Bond2D[],
  ): void {
    this.assertBondEndpoint(bond.i, atomCount);
    this.assertBondEndpoint(bond.j, atomCount);
    if (bond.i === bond.j) {
      throw new Error("bond endpoints must be distinct");
    }
    if (!Number.isInteger(bond.order) || bond.order < 1 || bond.order > 3) {
      throw new Error(`bond order must be 1, 2, or 3; got ${bond.order}`);
    }
    if (
      bond.stereo !== undefined &&
      bond.stereo !== "none" &&
      bond.stereo !== "up" &&
      bond.stereo !== "down"
    ) {
      throw new Error(`invalid bond stereo: ${String(bond.stereo)}`);
    }
    if (
      bond.order !== 1 &&
      bond.stereo !== undefined &&
      bond.stereo !== "none"
    ) {
      throw new Error("stereo is only valid on single bonds");
    }
    if (
      existing.some(
        (candidate) =>
          (candidate.i === bond.i && candidate.j === bond.j) ||
          (candidate.i === bond.j && candidate.j === bond.i),
      )
    ) {
      throw new Error(`duplicate bond between ${bond.i} and ${bond.j}`);
    }
    this.validateColor(bond.color, `bond ${bond.i}-${bond.j}`);
  }

  private validateColor(color: string | undefined, owner: string): void {
    if (color === undefined) return;
    try {
      normalizeSketchColor(color);
    } catch {
      throw new Error(`${owner}: invalid color ${color}`);
    }
  }

  private assertBondEndpoint(i: number, atomCount: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= atomCount) {
      throw new Error(`bond endpoint ${i} out of range (n=${atomCount})`);
    }
  }
}
