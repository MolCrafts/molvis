/**
 * ECS (Entity-Component-System) Core Types
 * Basic types and interfaces for the ECS architecture
 */

// Entity is represented as a unique symbol
export type Entity = symbol;

// Component data structure
export interface Component<T = unknown> {
  readonly data: T;
}

// Component type identifier  
export type ComponentType<T = unknown> = new (data: T) => Component<T>;

// Position component data
export interface Position {
  x: number;
  y: number;
  z: number;
}

// Element component data
export interface Element {
  symbol: string;
}

// Struct ID component data
export interface StructID {
  id: number;
}

// Component classes
export class PositionComponent implements Component<Position> {
  readonly data: Position;
  
  constructor(data: Position) {
    this.data = Object.freeze({ ...data });
  }
}

export class ElementComponent implements Component<Element> {
  readonly data: Element;
  
  constructor(data: Element) {
    this.data = Object.freeze({ ...data });
  }
}

export class StructIDComponent implements Component<StructID> {
  readonly data: StructID;
  
  constructor(data: StructID) {
    this.data = Object.freeze({ ...data });
  }
}

// Query result type for registry views
export interface QueryResult<T extends Record<string, Component>> {
  entity: Entity;
  components: T;
}
