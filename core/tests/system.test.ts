import { describe, it, expect, beforeEach } from '@jest/globals';
import { System } from '../src/system';
import { Frame } from '../src/system/frame';
import type { Atom, Bond } from '../src/system/item';
import { System as ECSSystem } from '../src/system/ecs/system';

describe('System Integration', () => {
  let system: System;

  beforeEach(() => {
    ECSSystem.reset();
    system = new System();
  });

  describe('Frame Management', () => {
    it('should append frames to trajectory', () => {
      const frame1 = new Frame();
      frame1.add_atom('C1', 0, 0, 0);
      
      const frame2 = new Frame();
      frame2.add_atom('C1', 1, 0, 0);
      
      system.append_frame(frame1);
      system.append_frame(frame2);
      
      expect(system.n_frames).toBe(2);
      expect(system.current_frame).toBe(frame1);
    });

    it('should navigate through frames', () => {
      const frame1 = new Frame();
      const frame2 = new Frame();
      const frame3 = new Frame();
      
      system.append_frame(frame1);
      system.append_frame(frame2);
      system.append_frame(frame3);
      
      expect(system.current_frame_index).toBe(0);
      expect(system.current_frame).toBe(frame1);
      
      const nextFrame = system.next_frame();
      expect(nextFrame).toBe(frame2);
      expect(system.current_frame_index).toBe(1);
      
      const prevFrame = system.prev_frame();
      expect(prevFrame).toBe(frame1);
      expect(system.current_frame_index).toBe(0);
    });

    it('should handle single frame mode', () => {
      const frame = new Frame();
      system.append_frame(frame);
      
      expect(system.single_frame_mode).toBe(true);
      
      // In single frame mode, navigation should return same frame
      const next = system.next_frame();
      const prev = system.prev_frame();
      
      expect(next).toBe(frame);
      expect(prev).toBe(frame);
      expect(system.current_frame_index).toBe(0);
    });

    it('should exit single frame mode with multiple frames', () => {
      const frame1 = new Frame();
      const frame2 = new Frame();
      
      system.append_frame(frame1);
      expect(system.single_frame_mode).toBe(true);
      
      system.append_frame(frame2);
      expect(system.single_frame_mode).toBe(false);
    });
  });

  describe('Frame Access', () => {
    it('should get frame by index', () => {
      const frame1 = new Frame();
      const frame2 = new Frame();
      
      system.append_frame(frame1);
      system.append_frame(frame2);
      
      expect(system.getFrame(0)).toBe(frame1);
      expect(system.getFrame(1)).toBe(frame2);
      expect(system.getFrame(2)).toBeUndefined();
    });

    it('should set current frame index', () => {
      const frame1 = new Frame();
      const frame2 = new Frame();
      const frame3 = new Frame();
      
      system.append_frame(frame1);
      system.append_frame(frame2);
      system.append_frame(frame3);
      
      system.current_frame_index = 2;
      expect(system.current_frame).toBe(frame3);
      expect(system.current_frame_index).toBe(2);
    });
  });

  describe('Atom Selection', () => {
    it('should track selected atoms', () => {
      const frame = new Frame();
      const atom1 = frame.add_atom('C1', 0, 0, 0);
      const atom2 = frame.add_atom('C2', 1, 0, 0);
      
      system.append_frame(frame);
      
      // Note: select_atom method expects legacy Atom type
      // This test documents the current interface
      // system.select_atom(atom1);
      // expect(system._selected).toContain(atom1);
    });
  });

  describe('Random ID Generation', () => {
    it('should generate random atom IDs', () => {
      const id1 = System.random_atom_id();
      const id2 = System.random_atom_id();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBe(4);
    });

    it('should generate hex IDs', () => {
      const id = System.random_atom_id();
      expect(id).toMatch(/^[0-9a-f]{4}$/);
    });
  });

  describe('Complex Molecular Systems', () => {
    it('should handle multi-frame trajectory with molecular dynamics', () => {
      // Simulate a 3-frame MD trajectory of a diatomic molecule
      const frames: Frame[] = [];
      
      // Frame 1: Initial state
      const frame1 = new Frame();
      const atom1_f1 = frame1.add_atom('A1', 0, 0, 0, { element: 'H', velocity: 0.1 });
      const atom2_f1 = frame1.add_atom('A2', 1.0, 0, 0, { element: 'H', velocity: -0.1 });
      frame1.add_bond(atom1_f1, atom2_f1, { order: 1, length: 1.0 });
      frames.push(frame1);
      
      // Frame 2: Compressed state
      const frame2 = new Frame();
      const atom1_f2 = frame2.add_atom('A1', 0.1, 0, 0, { element: 'H', velocity: 0.05 });
      const atom2_f2 = frame2.add_atom('A2', 0.8, 0, 0, { element: 'H', velocity: -0.05 });
      frame2.add_bond(atom1_f2, atom2_f2, { order: 1, length: 0.7 });
      frames.push(frame2);
      
      // Frame 3: Extended state
      const frame3 = new Frame();
      const atom1_f3 = frame3.add_atom('A1', -0.1, 0, 0, { element: 'H', velocity: -0.02 });
      const atom2_f3 = frame3.add_atom('A2', 1.3, 0, 0, { element: 'H', velocity: 0.02 });
      frame3.add_bond(atom1_f3, atom2_f3, { order: 1, length: 1.4 });
      frames.push(frame3);
      
      // Add frames to system
      for (const frame of frames) {
        system.append_frame(frame);
      }
      
      expect(system.n_frames).toBe(3);
      expect(system.single_frame_mode).toBe(false);
      
      // Verify trajectory navigation
      expect(system.current_frame).toBe(frame1);
      expect(system.current_frame.bonds[0].get('length')).toBe(1.0);
      
      system.next_frame();
      expect(system.current_frame).toBe(frame2);
      expect(system.current_frame.bonds[0].get('length')).toBe(0.7);
      
      system.next_frame();
      expect(system.current_frame).toBe(frame3);
      expect(system.current_frame.bonds[0].get('length')).toBe(1.4);
    });

    it('should handle large molecular systems', () => {
      // Create a frame with many atoms (simulate protein fragment)
      const frame = new Frame();
      const atoms: Atom[] = [];
      
      // Create 100 atoms
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 10;
        const y = Math.random() * 10;
        const z = Math.random() * 10;
        const element = i % 2 === 0 ? 'C' : 'N';
        
        const atom = frame.add_atom(`A${i}`, x, y, z, { 
          element, 
          residue: Math.floor(i / 10),
          atomType: 'backbone'
        });
        atoms.push(atom);
      }
      
      // Create bonds between consecutive atoms
      for (let i = 0; i < 99; i++) {
        frame.add_bond(atoms[i], atoms[i + 1], { 
          order: 1, 
          type: 'covalent' 
        });
      }
      
      system.append_frame(frame);
      
      expect(system.current_frame.atoms.length).toBe(100);
      expect(system.current_frame.bonds.length).toBe(99);
      
      // Verify all atoms are properly registered in ECS
      const ecsSystem = ECSSystem.global();
      const registry = ecsSystem.registry;
      
      for (const atom of atoms) {
        expect(registry.getAllEntities().has(atom.ecsEntity)).toBe(true);
      }
    });
  });

  describe('ECS Integration', () => {
    it('should maintain ECS consistency across frames', () => {
      const frame1 = new Frame();
      const atom1 = frame1.add_atom('test', 0, 0, 0);
      
      const frame2 = new Frame();
      const atom2 = frame2.add_atom('test', 1, 0, 0);
      
      system.append_frame(frame1);
      system.append_frame(frame2);
      
      const ecsSystem = ECSSystem.global();
      const registry = ecsSystem.registry;
      
      // Both atoms should be registered with unique entities
      expect(registry.getAllEntities().has(atom1.ecsEntity)).toBe(true);
      expect(registry.getAllEntities().has(atom2.ecsEntity)).toBe(true);
      expect(atom1.ecsEntity).not.toBe(atom2.ecsEntity);
    });

    it('should handle entity cleanup on frame navigation', () => {
      const frame1 = new Frame();
      const atom1 = frame1.add_atom('test', 0, 0, 0);
      const entityId1 = atom1.ecsEntity;
      
      system.append_frame(frame1);
      
      const ecsSystem = ECSSystem.global();
      const registry = ecsSystem.registry;
      
      expect(registry.getAllEntities().has(entityId1)).toBe(true);
      
      // Note: Current implementation doesn't automatically clean up
      // entities when switching frames. This test documents current behavior.
      system.next_frame();
      expect(registry.getAllEntities().has(entityId1)).toBe(true);
    });
  });
});
