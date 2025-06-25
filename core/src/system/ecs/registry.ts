import type { 
  Entity, 
  Component, 
  ComponentType, 
  QueryResult 
} from './types';

/**
 * Registry - Core ECS registry that manages entities and components
 * Similar to entt library's registry
 */
export class Registry {
  private _nextEntityId = 0;
  private _entities = new Set<Entity>();
  private _components = new Map<ComponentType, Map<Entity, Component>>();

  /**
   * Create a new entity
   */
  createEntity(): Entity {
    const entity = Symbol(`entity_${this._nextEntityId++}`);
    this._entities.add(entity);
    return entity;
  }

  /**
   * Remove an entity and all its components
   */
  removeEntity(entity: Entity): void {
    if (!this._entities.has(entity)) {
      return;
    }

    this._entities.delete(entity);
    
    // Remove all components for this entity
    for (const componentMap of Array.from(this._components.values())) {
      componentMap.delete(entity);
    }
  }

  /**
   * Add a component to an entity
   */
  addComponent<T>(entity: Entity, componentType: ComponentType<T>, data: T): void {
    if (!this._entities.has(entity)) {
      throw new Error(`Entity ${String(entity)} does not exist`);
    }

    const componentTypeKey = componentType as ComponentType;
    if (!this._components.has(componentTypeKey)) {
      this._components.set(componentTypeKey, new Map());
    }

    const componentMap = this._components.get(componentTypeKey);
    if (componentMap) {
      const component = new componentType(data);
      componentMap.set(entity, component);
    }
  }

  /**
   * Get a component from an entity
   */
  getComponent<T>(entity: Entity, componentType: ComponentType<T>): Component<T> | undefined {
    const componentTypeKey = componentType as ComponentType;
    const componentMap = this._components.get(componentTypeKey);
    if (!componentMap) {
      return undefined;
    }
    return componentMap.get(entity) as Component<T> | undefined;
  }

  /**
   * Check if an entity has a component
   */
  hasComponent<T>(entity: Entity, componentType: ComponentType<T>): boolean {
    const componentTypeKey = componentType as ComponentType;
    const componentMap = this._components.get(componentTypeKey);
    if (!componentMap) {
      return false;
    }
    return componentMap.has(entity);
  }

  /**
   * Remove a component from an entity
   */
  removeComponent<T>(entity: Entity, componentType: ComponentType<T>): void {
    const componentTypeKey = componentType as ComponentType;
    const componentMap = this._components.get(componentTypeKey);
    if (componentMap) {
      componentMap.delete(entity);
    }
  }

  /**
   * View entities with specific component types
   * Returns an iterator for efficient querying
   */
  view<T1>(
    componentType1: ComponentType<T1>
  ): Iterable<QueryResult<{ comp1: Component<T1> }>>;
  
  view<T1, T2>(
    componentType1: ComponentType<T1>,
    componentType2: ComponentType<T2>
  ): Iterable<QueryResult<{ comp1: Component<T1>; comp2: Component<T2> }>>;
  
  view<T1, T2, T3>(
    componentType1: ComponentType<T1>,
    componentType2: ComponentType<T2>,
    componentType3: ComponentType<T3>
  ): Iterable<QueryResult<{ comp1: Component<T1>; comp2: Component<T2>; comp3: Component<T3> }>>;

  view(...componentTypes: ComponentType[]): Iterable<QueryResult<Record<string, Component>>> {
    const self = this;
    
    return {
      *[Symbol.iterator]() {
        if (componentTypes.length === 0) {
          return;
        }

        // Get the component map with the smallest number of entities
        let smallestMap: Map<Entity, Component> | undefined;
        let smallestSize = Number.POSITIVE_INFINITY;
        
        for (const componentType of componentTypes) {
          const componentTypeKey = componentType as ComponentType;
          const componentMap = self._components.get(componentTypeKey);
          if (!componentMap || componentMap.size === 0) {
            return; // No entities have this component
          }
          if (componentMap.size < smallestSize) {
            smallestSize = componentMap.size;
            smallestMap = componentMap;
          }
        }

        if (!smallestMap) {
          return;
        }

        // Iterate through entities in the smallest map and check if they have all required components
        for (const entity of Array.from(smallestMap.keys())) {
          const components: Record<string, Component> = {};
          let hasAllComponents = true;

          for (let i = 0; i < componentTypes.length; i++) {
            const componentType = componentTypes[i];
            const component = self.getComponent(entity, componentType);
            if (!component) {
              hasAllComponents = false;
              break;
            }
            components[`comp${i + 1}`] = component;
          }

          if (hasAllComponents) {
            yield { entity, components };
          }
        }
      }
    };
  }

  /**
   * Get all entities
   */
  getAllEntities(): Set<Entity> {
    return new Set(this._entities);
  }

  /**
   * Get entity count
   */
  getEntityCount(): number {
    return this._entities.size;
  }

  /**
   * Clear all entities and components
   */
  clear(): void {
    this._entities.clear();
    this._components.clear();
    this._nextEntityId = 0;
  }
}
