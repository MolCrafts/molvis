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

// Query result type for registry views
export interface QueryResult<T extends Record<string, Component>> {
  entity: Entity;
  components: T;
}
