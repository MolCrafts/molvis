import { Registry } from '../../src/system/ecs/registry';
import { 
  PositionComponent, 
  ElementComponent, 
  StructIDComponent,
  type Position,
  type Element,
  type StructID
} from '../../src/system/ecs/types';

describe('Registry', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  describe('Entity Management', () => {
    test('should create unique entities', () => {
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      
      expect(entity1).not.toBe(entity2);
      expect(typeof entity1).toBe('symbol');
      expect(typeof entity2).toBe('symbol');
    });

    test('should track entity count', () => {
      expect(registry.getEntityCount()).toBe(0);
      
      registry.createEntity();
      expect(registry.getEntityCount()).toBe(1);
      
      registry.createEntity();
      expect(registry.getEntityCount()).toBe(2);
    });

    test('should remove entities', () => {
      const entity = registry.createEntity();
      expect(registry.getEntityCount()).toBe(1);
      
      registry.removeEntity(entity);
      expect(registry.getEntityCount()).toBe(0);
    });

    test('should handle removing non-existent entity', () => {
      const entity = Symbol('fake');
      expect(() => registry.removeEntity(entity)).not.toThrow();
    });
  });

  describe('Component Management', () => {
    test('should add and get components', () => {
      const entity = registry.createEntity();
      const position: Position = { x: 1, y: 2, z: 3 };
      
      registry.addComponent(entity, PositionComponent, position);
      
      const component = registry.getComponent(entity, PositionComponent);
      expect(component).toBeDefined();
      expect(component?.data).toEqual(position);
    });

    test('should check if entity has component', () => {
      const entity = registry.createEntity();
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(false);
      
      registry.addComponent(entity, PositionComponent, { x: 0, y: 0, z: 0 });
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(true);
    });

    test('should remove components', () => {
      const entity = registry.createEntity();
      registry.addComponent(entity, PositionComponent, { x: 0, y: 0, z: 0 });
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(true);
      
      registry.removeComponent(entity, PositionComponent);
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(false);
    });

    test('should throw error when adding component to non-existent entity', () => {
      const entity = Symbol('fake');
      
      expect(() => {
        registry.addComponent(entity, PositionComponent, { x: 0, y: 0, z: 0 });
      }).toThrow('Entity Symbol(fake) does not exist');
    });

    test('should handle multiple component types on same entity', () => {
      const entity = registry.createEntity();
      const position: Position = { x: 1, y: 2, z: 3 };
      const element: Element = { symbol: 'C' };
      const structId: StructID = { id: 1 };
      
      registry.addComponent(entity, PositionComponent, position);
      registry.addComponent(entity, ElementComponent, element);
      registry.addComponent(entity, StructIDComponent, structId);
      
      expect(registry.getComponent(entity, PositionComponent)?.data).toEqual(position);
      expect(registry.getComponent(entity, ElementComponent)?.data).toEqual(element);
      expect(registry.getComponent(entity, StructIDComponent)?.data).toEqual(structId);
    });
  });

  describe('Entity Queries (Views)', () => {
    test('should query entities with single component type', () => {
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      const entity3 = registry.createEntity();
      
      registry.addComponent(entity1, PositionComponent, { x: 1, y: 1, z: 1 });
      registry.addComponent(entity2, PositionComponent, { x: 2, y: 2, z: 2 });
      // entity3 has no position component
      
      const results = Array.from(registry.view(PositionComponent));
      
      expect(results).toHaveLength(2);
      expect(results.some(r => r.entity === entity1)).toBe(true);
      expect(results.some(r => r.entity === entity2)).toBe(true);
      expect(results.some(r => r.entity === entity3)).toBe(false);
    });

    test('should query entities with multiple component types', () => {
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      const entity3 = registry.createEntity();
      
      // entity1 has both components
      registry.addComponent(entity1, PositionComponent, { x: 1, y: 1, z: 1 });
      registry.addComponent(entity1, ElementComponent, { symbol: 'C' });
      
      // entity2 has only position
      registry.addComponent(entity2, PositionComponent, { x: 2, y: 2, z: 2 });
      
      // entity3 has only element
      registry.addComponent(entity3, ElementComponent, { symbol: 'O' });
      
      const results = Array.from(registry.view(PositionComponent, ElementComponent));
      
      expect(results).toHaveLength(1);
      expect(results[0].entity).toBe(entity1);
      expect(results[0].components.comp1.data).toEqual({ x: 1, y: 1, z: 1 });
      expect(results[0].components.comp2.data).toEqual({ symbol: 'C' });
    });

    test('should return empty results when no entities match', () => {
      const entity = registry.createEntity();
      registry.addComponent(entity, PositionComponent, { x: 1, y: 1, z: 1 });
      
      const results = Array.from(registry.view(ElementComponent));
      
      expect(results).toHaveLength(0);
    });

    test('should handle three component types query', () => {
      const entity = registry.createEntity();
      
      registry.addComponent(entity, PositionComponent, { x: 1, y: 1, z: 1 });
      registry.addComponent(entity, ElementComponent, { symbol: 'C' });
      registry.addComponent(entity, StructIDComponent, { id: 1 });
      
      const results = Array.from(registry.view(PositionComponent, ElementComponent, StructIDComponent));
      
      expect(results).toHaveLength(1);
      expect(results[0].entity).toBe(entity);
      expect(results[0].components.comp1.data).toEqual({ x: 1, y: 1, z: 1 });
      expect(results[0].components.comp2.data).toEqual({ symbol: 'C' });
      expect(results[0].components.comp3.data).toEqual({ id: 1 });
    });
  });

  describe('Registry Operations', () => {
    test('should clear all entities and components', () => {
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      
      registry.addComponent(entity1, PositionComponent, { x: 1, y: 1, z: 1 });
      registry.addComponent(entity2, ElementComponent, { symbol: 'C' });
      
      expect(registry.getEntityCount()).toBe(2);
      
      registry.clear();
      
      expect(registry.getEntityCount()).toBe(0);
      expect(Array.from(registry.view(PositionComponent))).toHaveLength(0);
      expect(Array.from(registry.view(ElementComponent))).toHaveLength(0);
    });

    test('should get all entities', () => {
      const entity1 = registry.createEntity();
      const entity2 = registry.createEntity();
      
      const allEntities = registry.getAllEntities();
      
      expect(allEntities.size).toBe(2);
      expect(allEntities.has(entity1)).toBe(true);
      expect(allEntities.has(entity2)).toBe(true);
    });
  });

  describe('Entity Removal with Components', () => {
    test('should remove all components when entity is removed', () => {
      const entity = registry.createEntity();
      
      registry.addComponent(entity, PositionComponent, { x: 1, y: 1, z: 1 });
      registry.addComponent(entity, ElementComponent, { symbol: 'C' });
      registry.addComponent(entity, StructIDComponent, { id: 1 });
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(true);
      expect(registry.hasComponent(entity, ElementComponent)).toBe(true);
      expect(registry.hasComponent(entity, StructIDComponent)).toBe(true);
      
      registry.removeEntity(entity);
      
      expect(registry.hasComponent(entity, PositionComponent)).toBe(false);
      expect(registry.hasComponent(entity, ElementComponent)).toBe(false);
      expect(registry.hasComponent(entity, StructIDComponent)).toBe(false);
    });
  });
});
