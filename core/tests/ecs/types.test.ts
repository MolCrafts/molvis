import { 
  PositionComponent, 
  ElementComponent, 
  StructIDComponent,
  type Position,
  type Element,
  type StructID
} from '../../src/system/ecs/types';

describe('Component Types', () => {
  describe('PositionComponent', () => {
    test('should create position component with immutable data', () => {
      const position: Position = { x: 1, y: 2, z: 3 };
      const component = new PositionComponent(position);
      
      expect(component.data).toEqual(position);
      
      // Data should be frozen (immutable)
      expect(() => {
        (component.data as unknown as { x: number }).x = 999;
      }).toThrow();
    });

    test('should handle different position values', () => {
      const positions = [
        { x: 0, y: 0, z: 0 },
        { x: -1.5, y: 2.7, z: -3.14 },
        { x: 1000, y: -1000, z: 0.001 }
      ];
      
      for (const pos of positions) {
        const component = new PositionComponent(pos);
        expect(component.data).toEqual(pos);
      }
    });

    test('should create separate instances for different data', () => {
      const pos1 = { x: 1, y: 2, z: 3 };
      const pos2 = { x: 4, y: 5, z: 6 };
      
      const comp1 = new PositionComponent(pos1);
      const comp2 = new PositionComponent(pos2);
      
      expect(comp1.data).not.toBe(comp2.data);
      expect(comp1.data).toEqual(pos1);
      expect(comp2.data).toEqual(pos2);
    });
  });

  describe('ElementComponent', () => {
    test('should create element component with immutable data', () => {
      const element: Element = { symbol: 'C' };
      const component = new ElementComponent(element);
      
      expect(component.data).toEqual(element);
      
      // Data should be frozen (immutable)
      expect(() => {
        (component.data as unknown as { symbol: string }).symbol = 'O';
      }).toThrow();
    });

    test('should handle different element symbols', () => {
      const elements = ['H', 'C', 'N', 'O', 'P', 'S', 'Fe', 'Au'];
      
      for (const symbol of elements) {
        const component = new ElementComponent({ symbol });
        expect(component.data.symbol).toBe(symbol);
      }
    });

    test('should handle empty and special symbols', () => {
      const specialSymbols = ['', 'X', 'Du', 'Lp'];
      
      for (const symbol of specialSymbols) {
        const component = new ElementComponent({ symbol });
        expect(component.data.symbol).toBe(symbol);
      }
    });
  });

  describe('StructIDComponent', () => {
    test('should create struct ID component with immutable data', () => {
      const structId: StructID = { id: 42 };
      const component = new StructIDComponent(structId);
      
      expect(component.data).toEqual(structId);
      
      // Data should be frozen (immutable)
      expect(() => {
        (component.data as unknown as { id: number }).id = 999;
      }).toThrow();
    });

    test('should handle different ID values', () => {
      const ids = [0, 1, 100, -1, 999999];
      
      for (const id of ids) {
        const component = new StructIDComponent({ id });
        expect(component.data.id).toBe(id);
      }
    });

    test('should handle edge case ID values', () => {
      const edgeCaseIds = [
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        0,
        -0
      ];
      
      for (const id of edgeCaseIds) {
        const component = new StructIDComponent({ id });
        expect(component.data.id).toBe(id);
      }
    });
  });

  describe('Component Immutability', () => {
    test('should not allow modification of original data object', () => {
      const originalPosition = { x: 1, y: 2, z: 3 };
      const component = new PositionComponent(originalPosition);
      
      // Modifying original should not affect component
      originalPosition.x = 999;
      
      expect(component.data.x).toBe(1);
    });

    test('should create deep copies of component data', () => {
      const position = { x: 1, y: 2, z: 3 };
      const component = new PositionComponent(position);
      
      expect(component.data).toEqual(position);
      expect(component.data).not.toBe(position);
    });
  });

  describe('Type Safety', () => {
    test('should enforce correct types at compile time', () => {
      // These should compile without errors
      const position: Position = { x: 1, y: 2, z: 3 };
      const element: Element = { symbol: 'C' };
      const structId: StructID = { id: 1 };
      
      const posComp = new PositionComponent(position);
      const elemComp = new ElementComponent(element);
      const structComp = new StructIDComponent(structId);
      
      expect(posComp).toBeInstanceOf(PositionComponent);
      expect(elemComp).toBeInstanceOf(ElementComponent);
      expect(structComp).toBeInstanceOf(StructIDComponent);
    });
  });
});
