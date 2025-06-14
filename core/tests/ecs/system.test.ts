import { System } from '../../src/system/ecs/system';
import { Registry } from '../../src/system/ecs/registry';

describe('System', () => {
  afterEach(() => {
    // Reset global state after each test
    System.reset();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance for multiple calls', () => {
      const system1 = System.global();
      const system2 = System.global();
      
      expect(system1).toBe(system2);
    });

    test('should provide access to registry', () => {
      const system = System.global();
      
      expect(system.registry).toBeInstanceOf(Registry);
    });

    test('should maintain registry state across calls', () => {
      const system1 = System.global();
      const entity = system1.registry.createEntity();
      
      const system2 = System.global();
      
      expect(system2.registry.getEntityCount()).toBe(1);
      expect(system2.registry.getAllEntities().has(entity)).toBe(true);
    });
  });

  describe('Reset Functionality', () => {
    test('should reset global instance', () => {
      const system1 = System.global();
      system1.registry.createEntity();
      
      expect(system1.registry.getEntityCount()).toBe(1);
      
      System.reset();
      
      const system2 = System.global();
      
      expect(system2.registry.getEntityCount()).toBe(0);
      expect(system2).not.toBe(system1);
    });

    test('should handle reset when no instance exists', () => {
      expect(() => System.reset()).not.toThrow();
    });
  });

  describe('Clear Functionality', () => {
    test('should clear registry while maintaining instance', () => {
      const system = System.global();
      system.registry.createEntity();
      system.registry.createEntity();
      
      expect(system.registry.getEntityCount()).toBe(2);
      
      system.clear();
      
      expect(system.registry.getEntityCount()).toBe(0);
      
      // Should be the same instance
      const sameSystem = System.global();
      expect(sameSystem).toBe(system);
    });
  });

  describe('Integration with Registry', () => {
    test('should work with registry operations', () => {
      const system = System.global();
      const registry = system.registry;
      
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      
      expect(registry.getEntityCount()).toBe(2);
      expect(registry.getAllEntities().has(entity1)).toBe(true);
      expect(registry.getAllEntities().has(entity2)).toBe(true);
    });
  });
});
