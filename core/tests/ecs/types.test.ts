import type { 
  Entity,
  Component,
  ComponentType,
  QueryResult
} from '../../src/system/ecs/types';

// Generic test component for testing ECS types
interface TestData {
  value: string;
}

class TestComponent implements Component<TestData> {
  constructor(public readonly data: TestData) {}
}

describe('ECS Core Types', () => {
  describe('Entity', () => {
    test('should be a symbol type', () => {
      const entity1 = Symbol('entity_1');
      const entity2 = Symbol('entity_2');
      
      expect(typeof entity1).toBe('symbol');
      expect(typeof entity2).toBe('symbol');
      expect(entity1).not.toBe(entity2);
    });
  });

  describe('Component', () => {
    test('should store data with readonly property', () => {
      const testData: TestData = { value: 'test' };
      const component = new TestComponent(testData);
      
      expect(component.data).toEqual(testData);
      expect(component.data.value).toBe('test');
    });

    test('should work with different data types', () => {
      interface NumberData { num: number; }
      interface BooleanData { flag: boolean; }
      
      class NumberComponent implements Component<NumberData> {
        constructor(public readonly data: NumberData) {}
      }
      
      class BooleanComponent implements Component<BooleanData> {
        constructor(public readonly data: BooleanData) {}
      }
      
      const numComp = new NumberComponent({ num: 42 });
      const boolComp = new BooleanComponent({ flag: true });
      
      expect(numComp.data.num).toBe(42);
      expect(boolComp.data.flag).toBe(true);
    });
  });

  describe('ComponentType', () => {
    test('should be a constructor function', () => {
      expect(typeof TestComponent).toBe('function');
      expect(TestComponent.prototype.constructor).toBe(TestComponent);
    });
  });

  describe('QueryResult', () => {
    test('should have entity and components properties', () => {
      const entity = Symbol('test_entity');
      const component = new TestComponent({ value: 'test' });
      
      const queryResult: QueryResult<{ comp1: Component<TestData> }> = {
        entity,
        components: { comp1: component }
      };
      
      expect(queryResult.entity).toBe(entity);
      expect(queryResult.components.comp1).toBe(component);
      expect(queryResult.components.comp1.data.value).toBe('test');
    });
  });
});
