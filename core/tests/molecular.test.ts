import { Molecule, Residue, Crystal, Bond, NewAtom as Atom } from '../src/system';

describe('New Molecular API', () => {
  describe('Atom', () => {
    test('should create atom with properties', () => {
      const atom = new Atom({
        element: 'C',
        position: { x: 1, y: 2, z: 3 }
      });
      
      expect(atom.element).toBe('C');
      expect(atom.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(atom.entity).toBeDefined();
    });

    test('should update atom properties', () => {
      const atom = new Atom({
        element: 'H',
        position: { x: 0, y: 0, z: 0 }
      });
      
      atom.element = 'N';
      atom.position = { x: 1, y: 1, z: 1 };
      
      expect(atom.element).toBe('N');
      expect(atom.position).toEqual({ x: 1, y: 1, z: 1 });
    });
  });

  describe('Molecule', () => {
    test('should create molecule and define atoms', () => {
      const mol = new Molecule('water', 'H2O');
      
      const o = mol.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
      const h1 = mol.def_atom({ element: 'H', position: { x: 0.96, y: 0, z: 0 } });
      const h2 = mol.def_atom({ element: 'H', position: { x: -0.24, y: 0.92, z: 0 } });
      
      expect(o.element).toBe('O');
      expect(h1.element).toBe('H');
      expect(h2.element).toBe('H');
      expect(mol.atomCount).toBe(0); // Not added yet
    });

    test('should add atoms to molecule', () => {
      const mol = new Molecule('water', 'H2O');
      
      const o = mol.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
      const h1 = mol.def_atom({ element: 'H', position: { x: 0.96, y: 0, z: 0 } });
      
      mol.add_atom(o);
      mol.add_atom(h1);
      
      expect(mol.atomCount).toBe(2);
      expect(o.structureId).toBe(mol.id);
      expect(h1.structureId).toBe(mol.id);
    });

    test('should calculate molecular weight', () => {
      const mol = new Molecule('water', 'H2O');
      
      const o = mol.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
      const h1 = mol.def_atom({ element: 'H', position: { x: 0.96, y: 0, z: 0 } });
      const h2 = mol.def_atom({ element: 'H', position: { x: -0.24, y: 0.92, z: 0 } });
      
      mol.add_atom(o);
      mol.add_atom(h1);
      mol.add_atom(h2);
      
      const weight = mol.getMolecularWeight();
      expect(weight).toBeCloseTo(18.015, 2); // H2O: 2*1.008 + 15.999
    });

    test('should calculate center of mass', () => {
      const mol = new Molecule('test');
      
      const c1 = mol.def_atom({ element: 'C', position: { x: 0, y: 0, z: 0 } });
      const c2 = mol.def_atom({ element: 'C', position: { x: 2, y: 0, z: 0 } });
      
      mol.add_atom(c1);
      mol.add_atom(c2);
      
      const centerOfMass = mol.getCenterOfMass();
      expect(centerOfMass).toEqual({ x: 1, y: 0, z: 0 });
    });

    test('should remove atoms', () => {
      const mol = new Molecule('test');
      
      const atom = mol.def_atom({ element: 'C', position: { x: 0, y: 0, z: 0 } });
      mol.add_atom(atom);
      
      expect(mol.atomCount).toBe(1);
      expect(atom.structureId).toBe(mol.id);
      
      mol.remove_atom(atom);
      
      expect(mol.atomCount).toBe(0);
      expect(atom.structureId).toBeUndefined();
    });
  });

  describe('Residue', () => {
    test('should create residue', () => {
      const res = new Residue('alanine', 'ALA', 1, 'A');
      
      expect(res.name).toBe('alanine');
      expect(res.residueType).toBe('ALA');
      expect(res.sequenceNumber).toBe(1);
      expect(res.chainId).toBe('A');
    });

    test('should identify amino acids', () => {
      const ala = new Residue('alanine', 'ALA');
      const gly = new Residue('glycine', 'GLY');
      const dna = new Residue('adenine', 'A');
      
      expect(ala.isAminoAcid()).toBe(true);
      expect(gly.isAminoAcid()).toBe(true);
      expect(dna.isAminoAcid()).toBe(false);
    });

    test('should identify nucleotides', () => {
      const ala = new Residue('alanine', 'ALA');
      const adenine = new Residue('adenine', 'A');
      const thymine = new Residue('thymine', 'T');
      
      expect(ala.isNucleotide()).toBe(false);
      expect(adenine.isNucleotide()).toBe(true);
      expect(thymine.isNucleotide()).toBe(true);
    });
  });

  describe('Crystal', () => {
    test('should create crystal', () => {
      const crystal = new Crystal('NaCl', 'P1');
      
      expect(crystal.name).toBe('NaCl');
      expect(crystal.spaceGroup).toBe('P1');
    });

    test('should set unit cell parameters', () => {
      const crystal = new Crystal('test', 'P1');
      
      crystal.unitCellParameters = {
        a: 10, b: 10, c: 10,
        alpha: 90, beta: 90, gamma: 90
      };
      
      expect(crystal.unitCellParameters).toEqual({
        a: 10, b: 10, c: 10,
        alpha: 90, beta: 90, gamma: 90
      });
    });

    test('should calculate unit cell volume', () => {
      const crystal = new Crystal('test', 'P1');
      
      crystal.unitCellParameters = {
        a: 10, b: 10, c: 10,
        alpha: 90, beta: 90, gamma: 90
      };
      
      const volume = crystal.getUnitCellVolume();
      expect(volume).toBeCloseTo(1000, 1);
    });
  });

  describe('Bond', () => {
    test('should create bond between atoms', () => {
      const mol = new Molecule('water');
      
      const o = mol.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
      const h = mol.def_atom({ element: 'H', position: { x: 1, y: 0, z: 0 } });
      
      mol.add_atom(o);
      mol.add_atom(h);
      
      const bond = new Bond(o, h, 1, 'single');
      
      expect(bond.atom1).toBe(o);
      expect(bond.atom2).toBe(h);
      expect(bond.order).toBe(1);
      expect(bond.type).toBe('single');
    });

    test('should calculate bond length', () => {
      const mol = new Molecule('test');
      
      const atom1 = mol.def_atom({ element: 'C', position: { x: 0, y: 0, z: 0 } });
      const atom2 = mol.def_atom({ element: 'C', position: { x: 1, y: 0, z: 0 } });
      
      mol.add_atom(atom1);
      mol.add_atom(atom2);
      
      const bond = new Bond(atom1, atom2);
      
      expect(bond.getLength()).toBeCloseTo(1.0, 3);
    });

    test('should identify intramolecular bonds', () => {
      const mol1 = new Molecule('mol1');
      const mol2 = new Molecule('mol2');
      
      const atom1 = mol1.def_atom({ element: 'C', position: { x: 0, y: 0, z: 0 } });
      const atom2 = mol1.def_atom({ element: 'N', position: { x: 1, y: 0, z: 0 } });
      const atom3 = mol2.def_atom({ element: 'O', position: { x: 2, y: 0, z: 0 } });
      
      mol1.add_atom(atom1);
      mol1.add_atom(atom2);
      mol2.add_atom(atom3);
      
      const intraBond = new Bond(atom1, atom2);
      const interBond = new Bond(atom1, atom3);
      
      expect(intraBond.isIntraMolecular()).toBe(true);
      expect(intraBond.isInterMolecular()).toBe(false);
      
      expect(interBond.isIntraMolecular()).toBe(false);
      expect(interBond.isInterMolecular()).toBe(true);
    });
  });

  describe('Integration', () => {
    test('should work with complex molecular system', () => {
      // Create a water molecule
      const water = new Molecule('water', 'H2O');
      
      const o = water.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
      const h1 = water.def_atom({ element: 'H', position: { x: 0.96, y: 0, z: 0 } });
      const h2 = water.def_atom({ element: 'H', position: { x: -0.24, y: 0.92, z: 0 } });
      
      water.add_atom(o);
      water.add_atom(h1);
      water.add_atom(h2);
      
      // Create bonds
      const bond1 = new Bond(o, h1, 1, 'single');
      const bond2 = new Bond(o, h2, 1, 'single');
      
      // Test molecular properties
      expect(water.atomCount).toBe(3);
      expect(water.getMolecularWeight()).toBeCloseTo(18.015, 2);
      
      // Test bonds
      expect(bond1.isIntraMolecular()).toBe(true);
      expect(bond2.isIntraMolecular()).toBe(true);
      expect(bond1.getLength()).toBeGreaterThan(0);
      expect(bond2.getLength()).toBeGreaterThan(0);
      
      // Create another molecule for inter-molecular bond
      const ammonia = new Molecule('ammonia', 'NH3');
      const n = ammonia.def_atom({ element: 'N', position: { x: 3, y: 0, z: 0 } });
      ammonia.add_atom(n);
      
      const hydrogenBond = new Bond(h1, n, 1, 'hydrogen');
      expect(hydrogenBond.isInterMolecular()).toBe(true);
    });
  });
});
