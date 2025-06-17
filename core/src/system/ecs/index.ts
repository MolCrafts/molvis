// Internal ECS exports - not exposed to users
export { Registry } from './registry';
export { System as ECSSystem } from './system';

// Type exports for internal use
export type {
  Entity,
  Component,
  ComponentType,
  QueryResult
} from './types';
