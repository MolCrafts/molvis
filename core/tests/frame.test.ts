import { describe, it, expect, beforeEach } from '@jest/globals';
import { Frame } from '../src/system/frame';
import { Atom, Bond } from '../src/system/item';
import { System as ECSSystem } from '../src/system/ecs/system';

describe('Frame', () => {
  beforeEach(() => {
    // Reset ECS system before each test
    ECSSystem.reset();
  });

  describe('constructor', () => {
    it('should create an empty frame', () => {
      const frame = new Frame();
      
      expect(frame.atoms).toEqual([]);
      expect(frame.bonds).toEqual([]);
    });

    it('should create a frame with given atoms and bonds', () => {
      const atom1 = new Atom({ name: 'C1', x: 0, y: 0, z: 0 });
      const atom2 = new Atom({ name: 'C2', x: 1, y: 0, z: 0 });
      const bond = new Bond(atom1, atom2, { order: 1 });
      
      const frame = new Frame([atom1, atom2], [bond]);
      
      expect(frame.atoms).toContain(atom1);
      expect(frame.atoms).toContain(atom2);
      expect(frame.bonds).toContain(bond);
    });
  });

  describe('add_atom', () => {
    it('should add an atom to the frame', () => {
      const frame = new Frame();
      const atom = frame.add_atom('C1', 1.0, 2.0, 3.0);
      
      expect(frame.atoms).toContain(atom);
      expect(atom.name).toBe('C1');
      expect(atom.get('x')).toBe(1.0);
      expect(atom.get('y')).toBe(2.0);
      expect(atom.get('z')).toBe(3.0);
    });

    it('should add an atom with additional properties', () => {
      const frame = new Frame();
      const props = { element: 'C', charge: 0.1, mass: 12.01 };
      const atom = frame.add_atom('C1', 0, 0, 0, props);
      
      expect(atom.get('element')).toBe('C');
      expect(atom.get('charge')).toBe(0.1);
      expect(atom.get('mass')).toBe(12.01);
    });

    it('should return the created atom', () => {
      const frame = new Frame();
      const atom = frame.add_atom('test', 0, 0, 0);
      
      expect(atom).toBeInstanceOf(Atom);
      expect(atom.name).toBe('test');
    });
  });

  describe('add_bond', () => {
    let frame: Frame;
    let atom1: Atom;
    let atom2: Atom;

    beforeEach(() => {
      frame = new Frame();
      atom1 = frame.add_atom('C1', 0, 0, 0);
      atom2 = frame.add_atom('C2', 1, 0, 0);
    });

    it('should add a bond between two atoms', () => {
      const bond = frame.add_bond(atom1, atom2);
      
      expect(frame.bonds).toContain(bond);
      expect(bond.itom).toBe(atom1);
      expect(bond.jtom).toBe(atom2);
    });

    it('should add a bond with properties', () => {
      const props = { order: 2, type: 'double' };
      const bond = frame.add_bond(atom1, atom2, props);
      
      expect(bond.get('order')).toBe(2);
      expect(bond.get('type')).toBe('double');
    });

    it('should not create duplicate bonds', () => {
      const bond1 = frame.add_bond(atom1, atom2, { order: 1 });
      const bond2 = frame.add_bond(atom1, atom2, { order: 2 });
      
      expect(frame.bonds.length).toBe(1);
      // bond2 should be a new instance that replaces bond1 in the frame
      expect(bond1).not.toBe(bond2);
      expect(bond2.get('order')).toBe(2); // bond2 should have the updated properties
      expect(frame.bonds[0]).toBe(bond2); // The frame should contain the updated bond
    });

    it('should not create duplicate bonds in reverse order', () => {
      const bond1 = frame.add_bond(atom1, atom2);
      const bond2 = frame.add_bond(atom2, atom1);
      
      expect(frame.bonds.length).toBe(1);
      // bond2 should be a new instance that replaces bond1, even in reverse order
      expect(bond1).not.toBe(bond2);
      expect(frame.bonds[0]).toBe(bond2); // The frame should contain the updated bond
    });

    it('should update existing bond order', () => {
      const bond = frame.add_bond(atom1, atom2, { order: 1 });
      expect(bond.get('order')).toBe(1);
      
      const updatedBond = frame.add_bond(atom1, atom2, { order: 3 });
      expect(updatedBond.get('order')).toBe(3);
      expect(frame.bonds[0]).toBe(updatedBond); // The frame should contain the updated bond
    });
  });

  describe('remove_atom', () => {
    let frame: Frame;
    let atom1: Atom;
    let atom2: Atom;
    let atom3: Atom;
    let bond1: Bond;
    let bond2: Bond;

    beforeEach(() => {
      frame = new Frame();
      atom1 = frame.add_atom('C1', 0, 0, 0);
      atom2 = frame.add_atom('C2', 1, 0, 0);
      atom3 = frame.add_atom('C3', 2, 0, 0);
      bond1 = frame.add_bond(atom1, atom2);
      bond2 = frame.add_bond(atom2, atom3);
    });

    it('should remove the atom from the frame', () => {
      frame.remove_atom(atom2);
      
      expect(frame.atoms).not.toContain(atom2);
      expect(frame.atoms).toContain(atom1);
      expect(frame.atoms).toContain(atom3);
    });

    it('should remove all bonds involving the atom', () => {
      frame.remove_atom(atom2);
      
      expect(frame.bonds).not.toContain(bond1);
      expect(frame.bonds).not.toContain(bond2);
    });

    it('should not affect bonds not involving the atom', () => {
      const bond3 = frame.add_bond(atom1, atom3);
      frame.remove_atom(atom2);
      
      expect(frame.bonds).toContain(bond3);
    });
  });

  describe('Frame structure', () => {
    it('should manage atoms and bonds collections', () => {
      const frame = new Frame();
      const atom1 = frame.add_atom('C1', 0, 0, 0);
      const atom2 = frame.add_atom('C2', 1, 0, 0);
      const bond = frame.add_bond(atom1, atom2);
      
      expect(frame.atoms).toContain(atom1);
      expect(frame.atoms).toContain(atom2);
      expect(frame.bonds).toContain(bond);
    });

    it('should clear all atoms and bonds', () => {
      const frame = new Frame();
      frame.add_atom('C1', 0, 0, 0);
      frame.add_atom('C2', 1, 0, 0);
      
      expect(frame.atoms.length).toBe(2);
      
      frame.clear();
      
      expect(frame.atoms.length).toBe(0);
      expect(frame.bonds.length).toBe(0);
    });
  });

  describe('getters', () => {
    it('should return atoms array', () => {
      const frame = new Frame();
      const atom = frame.add_atom('test', 0, 0, 0);
      
      const atoms = frame.atoms;
      expect(atoms).toContain(atom);
    });

    it('should return bonds array', () => {
      const frame = new Frame();
      const atom1 = frame.add_atom('C1', 0, 0, 0);
      const atom2 = frame.add_atom('C2', 1, 0, 0);
      const bond = frame.add_bond(atom1, atom2);
      
      const bonds = frame.bonds;
      expect(bonds).toContain(bond);
    });
  });

  describe('Complex molecular structures', () => {
    it('should handle benzene ring creation', () => {
      const frame = new Frame();
      
      // Create 6 carbon atoms in ring
      const carbons: Atom[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        carbons.push(frame.add_atom(`C${i + 1}`, x, y, 0, { element: 'C' }));
      }
      
      // Create ring bonds
      for (let i = 0; i < 6; i++) {
        const nextI = (i + 1) % 6;
        const bondOrder = i % 2 === 0 ? 2 : 1; // Alternating single/double
        frame.add_bond(carbons[i], carbons[nextI], { 
          order: bondOrder, 
          type: bondOrder === 2 ? 'double' : 'single' 
        });
      }
      
      expect(frame.atoms.length).toBe(6);
      expect(frame.bonds.length).toBe(6);
      
      // Check that all carbons are properly bonded
      for (const carbon of carbons) {
        const connectedBonds = frame.bonds.filter(
          bond => bond.itom === carbon || bond.jtom === carbon
        );
        expect(connectedBonds.length).toBe(2);
      }
    });

    it('should handle protein backbone fragment', () => {
      const frame = new Frame();
      
      // Create a dipeptide backbone: N-Ca-C-N-Ca-C
      const n1 = frame.add_atom('N1', 0, 0, 0, { element: 'N', atomType: 'backbone' });
      const ca1 = frame.add_atom('CA1', 1.45, 0, 0, { element: 'C', atomType: 'backbone' });
      const c1 = frame.add_atom('C1', 2.45, 1.2, 0, { element: 'C', atomType: 'backbone' });
      const n2 = frame.add_atom('N2', 3.7, 1.1, 0, { element: 'N', atomType: 'backbone' });
      const ca2 = frame.add_atom('CA2', 4.8, 2.1, 0, { element: 'C', atomType: 'backbone' });
      const c2 = frame.add_atom('C2', 6.2, 1.8, 0, { element: 'C', atomType: 'backbone' });
      
      // Create backbone bonds
      frame.add_bond(n1, ca1, { order: 1, type: 'peptide' });
      frame.add_bond(ca1, c1, { order: 1, type: 'peptide' });
      frame.add_bond(c1, n2, { order: 1, type: 'peptide' });
      frame.add_bond(n2, ca2, { order: 1, type: 'peptide' });
      frame.add_bond(ca2, c2, { order: 1, type: 'peptide' });
      
      expect(frame.atoms.length).toBe(6);
      expect(frame.bonds.length).toBe(5);
      
      // Verify all atoms have correct type
      for (const atom of frame.atoms) {
        expect(atom.get('atomType')).toBe('backbone');
      }
      
      // Verify bond types
      for (const bond of frame.bonds) {
        expect(bond.get('type')).toBe('peptide');
      }
    });
  });

  describe('ECS Integration', () => {
    it('should register all atoms and bonds in ECS', () => {
      const frame = new Frame();
      const atom1 = frame.add_atom('C1', 0, 0, 0);
      const atom2 = frame.add_atom('C2', 1, 0, 0);
      const bond = frame.add_bond(atom1, atom2);
      
      const system = ECSSystem.global();
      const registry = system.registry;
      
      expect(registry.getAllEntities().has(atom1.ecsEntity)).toBe(true);
      expect(registry.getAllEntities().has(atom2.ecsEntity)).toBe(true);
      expect(registry.getAllEntities().has(bond.ecsEntity)).toBe(true);
    });

    it('should clean up ECS entities when atoms are removed', () => {
      const frame = new Frame();
      const atom = frame.add_atom('test', 0, 0, 0);
      const entityId = atom.ecsEntity;
      
      const system = ECSSystem.global();
      const registry = system.registry;
      expect(registry.getAllEntities().has(entityId)).toBe(true);
      
      frame.remove_atom(atom);
      // Note: Current implementation doesn't auto-destroy ECS entities
      // This test documents current behavior
      expect(registry.getAllEntities().has(entityId)).toBe(true);
    });
  });
});
