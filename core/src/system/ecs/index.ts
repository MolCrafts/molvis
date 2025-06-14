// Internal ECS exports - not exposed to users
export { Registry } from './registry';
export { System as ECSSystem } from './system';

// Type exports for internal use
export type {
  Entity,
  Component,
  ComponentType,
  Position,
  Element,
  StructID,
  QueryResult
} from './types';

export {
  PositionComponent,
  ElementComponent,
  StructIDComponent
} from './types';
