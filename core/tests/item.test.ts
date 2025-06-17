import { describe, it, expect, beforeEach } from '@jest/globals';
import { Atom, Bond } from '../src/system/item';
import { System as ECSSystem } from '../src/system/ecs/system';

describe('Atom', () => {
  beforeEach(() => {
    // Reset ECS system before each test
    ECSSystem.reset();
  });

  describe('constructor', () => {
    it('should create an atom with empty properties', () => {
      const atom = new Atom();
      expect(atom).toBeDefined();
      expect(atom.ecsEntity).toBeDefined();
    });

    it('should create an atom with given properties', () => {
      const props = {
        name: 'C1',
        x: 1.0,
        y: 2.0,
        z: 3.0,
        type: 'carbon'
      };
      const atom = new Atom(props);
      
      expect(atom.get('name')).toBe('C1');
      expect(atom.get('x')).toBe(1.0);
      expect(atom.get('y')).toBe(2.0);
      expect(atom.get('z')).toBe(3.0);
      expect(atom.get('type')).toBe('carbon');
    });

    it('should automatically register with ECS system', () => {
      const atom = new Atom({ name: 'test' });
      const system = ECSSystem.global();
      const registry = system.registry;
      
      expect(registry.getAllEntities().has(atom.ecsEntity)).toBe(true);
    });
  });

  describe('name getter', () => {
    it('should return the name property', () => {
      const atom = new Atom({ name: 'TestAtom' });
      expect(atom.name).toBe('TestAtom');
    });

    it('should handle missing name property', () => {
      const atom = new Atom();
      expect(atom.name).toBeUndefined();
    });
  });

  describe('xyz getter', () => {
    it('should return Vector3 from x, y, z properties', () => {
      const atom = new Atom({ x: 1.5, y: -2.3, z: 4.7 });
      const xyz = atom.xyz;
      
      expect(xyz.x).toBe(1.5);
      expect(xyz.y).toBe(-2.3);
      expect(xyz.z).toBe(4.7);
    });

    it('should return zero vector for missing coordinates', () => {
      const atom = new Atom();
      const xyz = atom.xyz;
      
      expect(xyz.x).toBe(0);
      expect(xyz.y).toBe(0);
      expect(xyz.z).toBe(0);
    });

    it('should handle partial coordinates', () => {
      const atom = new Atom({ x: 1.0, z: 3.0 });
      const xyz = atom.xyz;
      
      expect(xyz.x).toBe(1.0);
      expect(xyz.y).toBe(0);
      expect(xyz.z).toBe(3.0);
    });
  });

  describe('updateProperty', () => {
    it('should return new instance with updated property', () => {
      const original = new Atom({ name: 'original', x: 1.0 });
      const updated = original.updateProperty('x', 2.0);
      
      expect(updated).not.toBe(original);
      expect(updated.get('x')).toBe(2.0);
      expect(updated.get('name')).toBe('original');
      expect(original.get('x')).toBe(1.0); // Original unchanged
    });

    it('should add new property', () => {
      const original = new Atom({ name: 'test' });
      const updated = original.updateProperty('newProp', 'newValue');
      
      expect(updated.get('newProp')).toBe('newValue');
      expect(original.has('newProp')).toBe(false);
    });
  });

  describe('Entity methods', () => {
    it('should support has() method', () => {
      const atom = new Atom({ name: 'test', x: 1.0 });
      
      expect(atom.has('name')).toBe(true);
      expect(atom.has('x')).toBe(true);
      expect(atom.has('missing')).toBe(false);
    });

    it('should support keys() method', () => {
      const atom = new Atom({ name: 'test', x: 1.0, y: 2.0 });
      const keys = atom.keys();
      
      expect(keys).toContain('name');
      expect(keys).toContain('x');
      expect(keys).toContain('y');
      expect(keys.length).toBe(3);
    });

    it('should support toJSON() method', () => {
      const props = { name: 'test', x: 1.0, y: 2.0 };
      const atom = new Atom(props);
      const json = atom.toJSON();
      
      expect(json).toEqual(props);
    });

    it('should support with() method for immutable updates', () => {
      const original = new Atom({ name: 'test', x: 1.0 });
      const updated = original.with('x', 5.0);
      
      expect(updated.get('x')).toBe(5.0);
      expect(original.get('x')).toBe(1.0);
    });
  });

  describe('destroy', () => {
    it('should remove entity from ECS system', () => {
      const atom = new Atom({ name: 'test' });
      const system = ECSSystem.global();
      const registry = system.registry;
      const entityId = atom.ecsEntity;
      
      expect(registry.getAllEntities().has(entityId)).toBe(true);
      
      atom.destroy();
      
      expect(registry.getAllEntities().has(entityId)).toBe(false);
    });
  });
});

describe('Bond', () => {
  let atom1: Atom;
  let atom2: Atom;

  beforeEach(() => {
    ECSSystem.reset();
    atom1 = new Atom({ name: 'C1', x: 0, y: 0, z: 0 });
    atom2 = new Atom({ name: 'C2', x: 1, y: 0, z: 0 });
  });

  describe('constructor', () => {
    it('should create a bond between two atoms', () => {
      const bond = new Bond(atom1, atom2);
      
      expect(bond.itom).toBe(atom1);
      expect(bond.jtom).toBe(atom2);
      expect(bond.ecsEntity).toBeDefined();
    });

    it('should create a bond with properties', () => {
      const props = { order: 2, type: 'double' };
      const bond = new Bond(atom1, atom2, props);
      
      expect(bond.get('order')).toBe(2);
      expect(bond.get('type')).toBe('double');
    });

    it('should automatically register with ECS system', () => {
      const bond = new Bond(atom1, atom2, { order: 1 });
      const system = ECSSystem.global();
      const registry = system.registry;
      
      expect(registry.getAllEntities().has(bond.ecsEntity)).toBe(true);
    });
  });

  describe('atom getters', () => {
    it('should return correct atoms', () => {
      const bond = new Bond(atom1, atom2);
      
      expect(bond.itom).toBe(atom1);
      expect(bond.jtom).toBe(atom2);
    });
  });

  describe('name getter', () => {
    it('should return explicit name if provided', () => {
      const bond = new Bond(atom1, atom2, { name: 'CustomBond' });
      expect(bond.name).toBe('CustomBond');
    });

    it('should generate name from atom names if not provided', () => {
      const bond = new Bond(atom1, atom2);
      expect(bond.name).toBe('C1-C2');
    });

    it('should handle atoms without names', () => {
      const atomA = new Atom();
      const atomB = new Atom();
      const bond = new Bond(atomA, atomB);
      
      expect(bond.name).toBe('undefined-undefined');
    });
  });

  describe('order getter', () => {
    it('should return order property', () => {
      const bond = new Bond(atom1, atom2, { order: 3 });
      expect(bond.order).toBe(3);
    });

    it('should default to 1 if not specified', () => {
      const bond = new Bond(atom1, atom2);
      expect(bond.order).toBe(1);
    });
  });

  describe('updateProperty', () => {
    it('should return new bond instance with updated property', () => {
      const original = new Bond(atom1, atom2, { order: 1 });
      const updated = original.updateProperty('order', 2);
      
      expect(updated).not.toBe(original);
      expect(updated.get('order')).toBe(2);
      expect(updated.itom).toBe(atom1);
      expect(updated.jtom).toBe(atom2);
      expect(original.get('order')).toBe(1); // Original unchanged
    });

    it('should preserve atom references in new instance', () => {
      const original = new Bond(atom1, atom2, { type: 'single' });
      const updated = original.updateProperty('type', 'double');
      
      expect(updated.itom).toBe(atom1);
      expect(updated.jtom).toBe(atom2);
    });
  });

  describe('Entity methods', () => {
    it('should support entity operations', () => {
      const props = { order: 2, type: 'double', length: 1.5 };
      const bond = new Bond(atom1, atom2, props);
      
      expect(bond.has('order')).toBe(true);
      expect(bond.has('type')).toBe(true);
      expect(bond.has('missing')).toBe(false);
      
      const keys = bond.keys();
      expect(keys).toContain('order');
      expect(keys).toContain('type');
      expect(keys).toContain('length');
      
      const json = bond.toJSON();
      expect(json).toEqual(props);
    });
  });

  describe('destroy', () => {
    it('should remove entity from ECS system', () => {
      const bond = new Bond(atom1, atom2, { order: 1 });
      const system = ECSSystem.global();
      const registry = system.registry;
      const entityId = bond.ecsEntity;
      
      expect(registry.getAllEntities().has(entityId)).toBe(true);
      
      bond.destroy();
      
      expect(registry.getAllEntities().has(entityId)).toBe(false);
    });
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    ECSSystem.reset();
  });

  it('should create multiple entities with unique ECS IDs', () => {
    const atom1 = new Atom({ name: 'C1' });
    const atom2 = new Atom({ name: 'C2' });
    const bond = new Bond(atom1, atom2, { order: 1 });
    
    expect(atom1.ecsEntity).not.toBe(atom2.ecsEntity);
    expect(atom1.ecsEntity).not.toBe(bond.ecsEntity);
    expect(atom2.ecsEntity).not.toBe(bond.ecsEntity);
  });

  it('should maintain ECS entities when updating properties', () => {
    const atom = new Atom({ name: 'C1', x: 0 });
    const originalEntity = atom.ecsEntity;
    
    const updated = atom.updateProperty('x', 1.0);
    
    expect(updated.ecsEntity).not.toBe(originalEntity);
    
    const system = ECSSystem.global();
    const registry = system.registry;
    expect(registry.getAllEntities().has(originalEntity)).toBe(true);
    expect(registry.getAllEntities().has(updated.ecsEntity)).toBe(true);
  });

  it('should handle complex molecular structures', () => {
    // Create a water molecule
    const oxygen = new Atom({ 
      name: 'O1', 
      x: 0, y: 0, z: 0, 
      element: 'O', 
      charge: -0.8 
    });
    
    const hydrogen1 = new Atom({ 
      name: 'H1', 
      x: 0.96, y: 0, z: 0, 
      element: 'H', 
      charge: 0.4 
    });
    
    const hydrogen2 = new Atom({ 
      name: 'H2', 
      x: -0.24, y: 0.93, z: 0, 
      element: 'H', 
      charge: 0.4 
    });
    
    const bond1 = new Bond(oxygen, hydrogen1, { 
      order: 1, 
      type: 'covalent', 
      length: 0.96 
    });
    
    const bond2 = new Bond(oxygen, hydrogen2, { 
      order: 1, 
      type: 'covalent', 
      length: 0.96 
    });
    
    // Verify structure
    expect(oxygen.get('element')).toBe('O');
    expect(hydrogen1.get('element')).toBe('H');
    expect(hydrogen2.get('element')).toBe('H');
    
    expect(bond1.itom).toBe(oxygen);
    expect(bond1.jtom).toBe(hydrogen1);
    expect(bond2.itom).toBe(oxygen);
    expect(bond2.jtom).toBe(hydrogen2);
    
    expect(bond1.get('type')).toBe('covalent');
    expect(bond2.get('type')).toBe('covalent');
    
    // Verify all entities are registered in ECS
    const system = ECSSystem.global();
    const registry = system.registry;
    
    expect(registry.getAllEntities().has(oxygen.ecsEntity)).toBe(true);
    expect(registry.getAllEntities().has(hydrogen1.ecsEntity)).toBe(true);
    expect(registry.getAllEntities().has(hydrogen2.ecsEntity)).toBe(true);
    expect(registry.getAllEntities().has(bond1.ecsEntity)).toBe(true);
    expect(registry.getAllEntities().has(bond2.ecsEntity)).toBe(true);
  });
});
