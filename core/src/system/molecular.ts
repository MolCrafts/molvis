import type { Position } from './ecs';
import { Atom, type IAtomProp } from './atom';

/**
 * Base class for all molecular structures
 * Provides a high-level interface that hides ECS implementation details
 */
abstract class MolecularStructure {
  private static _nextStructId = 1;
  
  protected _id: number;
  protected _name: string;
  protected _atoms: Atom[] = [];
  
  constructor(name: string) {
    this._id = MolecularStructure._nextStructId++;
    this._name = name;
  }

  /**
   * Get the unique ID of this structure
   */
  get id(): number {
    return this._id;
  }

  /**
   * Get the name of this structure
   */
  get name(): string {
    return this._name;
  }

  /**
   * Get the number of atoms in this structure
   */
  get atomCount(): number {
    return this._atoms.length;
  }

  /**
   * Define a new atom (creates Atom object but doesn't add to structure yet)
   */
  def_atom(props: IAtomProp): Atom {
    return new Atom(props);
  }

  /**
   * Add an atom to this structure
   */
  add_atom(atom: Atom): void {
    // Set the structure ID on the atom
    atom.setStructureId(this._id);
    
    // Add to local tracking
    this._atoms.push(atom);
  }

  /**
   * Remove an atom from this structure
   */
  remove_atom(atom: Atom): void {
    const index = this._atoms.indexOf(atom);
    if (index === -1) {
      return;
    }
    
    // Remove structure association
    atom.removeFromStructure();
    
    // Remove from local tracking
    this._atoms.splice(index, 1);
  }

  /**
   * Get all atoms in this structure
   */
  getAllAtoms(): readonly Atom[] {
    return Object.freeze([...this._atoms]);
  }

  /**
   * Get atom by index
   */
  getAtom(index: number): Atom | undefined {
    return this._atoms[index];
  }

  /**
   * Clear all atoms from this structure
   */
  clear(): void {
    for (const atom of this._atoms) {
      atom.removeFromStructure();
    }
    this._atoms.length = 0;
  }
}

/**
 * Molecule class for representing molecular structures
 */
export class Molecule extends MolecularStructure {
  private _formula?: string;

  constructor(name: string, formula?: string) {
    super(name);
    this._formula = formula;
  }

  get formula(): string | undefined {
    return this._formula;
  }

  set formula(formula: string | undefined) {
    this._formula = formula;
  }

  /**
   * Calculate molecular weight (simplified - using approximate atomic masses)
   */
  getMolecularWeight(): number {
    const atomicMasses: Record<string, number> = {
      'H': 1.008, 'C': 12.011, 'N': 14.007, 'O': 15.999,
      'P': 30.974, 'S': 32.065, 'Cl': 35.453, 'Na': 22.990,
      'K': 39.098, 'Ca': 40.078, 'Mg': 24.305, 'Fe': 55.845
    };

    let totalMass = 0;
    const atoms = this.getAllAtoms();
    
    for (const atom of atoms) {
      const mass = atomicMasses[atom.element] || 1.0;
      totalMass += mass;
    }

    return totalMass;
  }

  /**
   * Get center of mass
   */
  getCenterOfMass(): Position {
    const atoms = this.getAllAtoms();
    if (atoms.length === 0) {
      return { x: 0, y: 0, z: 0 };
    }

    const atomicMasses: Record<string, number> = {
      'H': 1.008, 'C': 12.011, 'N': 14.007, 'O': 15.999,
      'P': 30.974, 'S': 32.065, 'Cl': 35.453, 'Na': 22.990,
      'K': 39.098, 'Ca': 40.078, 'Mg': 24.305, 'Fe': 55.845
    };

    let totalMass = 0;
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;

    for (const atom of atoms) {
      const mass = atomicMasses[atom.element] || 1.0;
      const pos = atom.position;
      totalMass += mass;
      centerX += pos.x * mass;
      centerY += pos.y * mass;
      centerZ += pos.z * mass;
    }

    return {
      x: centerX / totalMass,
      y: centerY / totalMass,
      z: centerZ / totalMass
    };
  }
}

/**
 * Residue class for representing amino acid residues or nucleotides
 */
export class Residue extends MolecularStructure {
  private _residueType: string;
  private _sequenceNumber?: number;
  private _chainId?: string;

  constructor(name: string, residueType = '', sequenceNumber?: number, chainId?: string) {
    super(name);
    this._residueType = residueType;
    this._sequenceNumber = sequenceNumber;
    this._chainId = chainId;
  }

  get residueType(): string {
    return this._residueType;
  }

  get sequenceNumber(): number | undefined {
    return this._sequenceNumber;
  }

  get chainId(): string | undefined {
    return this._chainId;
  }

  /**
   * Check if this residue is an amino acid
   */
  isAminoAcid(): boolean {
    const aminoAcids = [
      'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLU', 'GLN', 'GLY', 'HIS', 'ILE',
      'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'
    ];
    return aminoAcids.includes(this._residueType);
  }

  /**
   * Check if this residue is a nucleotide
   */
  isNucleotide(): boolean {
    const nucleotides = ['A', 'T', 'G', 'C', 'U', 'DA', 'DT', 'DG', 'DC'];
    return nucleotides.includes(this._residueType);
  }
}

/**
 * Crystal class for representing crystalline structures
 */
export class Crystal extends MolecularStructure {
  private _spaceGroup: string;
  private _unitCellParams?: {
    a: number; b: number; c: number;
    alpha: number; beta: number; gamma: number;
  };

  constructor(name: string, spaceGroup: string) {
    super(name);
    this._spaceGroup = spaceGroup;
  }

  get spaceGroup(): string {
    return this._spaceGroup;
  }

  get unitCellParameters() {
    return this._unitCellParams;
  }

  set unitCellParameters(params: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number } | undefined) {
    this._unitCellParams = params;
  }

  /**
   * Calculate unit cell volume
   */
  getUnitCellVolume(): number | undefined {
    if (!this._unitCellParams) {
      return undefined;
    }

    const { a, b, c, alpha, beta, gamma } = this._unitCellParams;
    
    // Convert angles to radians
    const alphaRad = (alpha * Math.PI) / 180;
    const betaRad = (beta * Math.PI) / 180;
    const gammaRad = (gamma * Math.PI) / 180;

    // Calculate volume using the formula for general unit cell
    const volume = a * b * c * Math.sqrt(
      1 + 2 * Math.cos(alphaRad) * Math.cos(betaRad) * Math.cos(gammaRad) -
      Math.cos(alphaRad) ** 2 - Math.cos(betaRad) ** 2 - Math.cos(gammaRad) ** 2
    );

    return volume;
  }
}

/**
 * Bond class for representing chemical bonds between atoms
 * Now uses Atom objects directly instead of structure + index
 */
export class Bond {
  private _atom1: Atom;
  private _atom2: Atom;
  private _order: number;
  private _type: string;

  constructor(atom1: Atom, atom2: Atom, order = 1, type = 'single') {
    this._atom1 = atom1;
    this._atom2 = atom2;
    this._order = order;
    this._type = type;
  }

  get atom1(): Atom {
    return this._atom1;
  }

  get atom2(): Atom {
    return this._atom2;
  }

  get order(): number {
    return this._order;
  }

  set order(order: number) {
    this._order = order;
  }

  get type(): string {
    return this._type;
  }

  set type(type: string) {
    this._type = type;
  }

  /**
   * Calculate bond length
   */
  getLength(): number {
    const pos1 = this._atom1.position;
    const pos2 = this._atom2.position;

    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Check if this is an intra-molecular bond (within same structure)
   */
  isIntraMolecular(): boolean {
    const struct1Id = this._atom1.structureId;
    const struct2Id = this._atom2.structureId;
    
    return struct1Id !== undefined && struct2Id !== undefined && struct1Id === struct2Id;
  }

  /**
   * Check if this is an inter-molecular bond (between different structures)
   */
  isInterMolecular(): boolean {
    return !this.isIntraMolecular();
  }
}
