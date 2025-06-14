import { ECSSystem, PositionComponent, ElementComponent, StructIDComponent, type Entity, type Position } from './ecs';

/**
 * Interface for atom properties
 */
export interface IAtomProp {
  element: string;
  position: Position;
  [key: string]: unknown;
}

/**
 * Atom class that wraps an ECS Entity
 * Each Atom has a globally unique Entity ID that can be used to access data from Registry
 */
export class Atom {
  private _entity: Entity;

  constructor(props: IAtomProp) {
    // Create entity in the global registry
    const system = ECSSystem.global();
    const registry = system.registry;
    
    this._entity = registry.createEntity();
    
    // Add components to the entity
    registry.addComponent(this._entity, ElementComponent, { symbol: props.element });
    registry.addComponent(this._entity, PositionComponent, props.position);
    
    // Additional properties can be extended later if needed
  }

  /**
   * Get the global Entity ID for this atom
   */
  get entity(): Entity {
    return this._entity;
  }

  /**
   * Get the element symbol of this atom
   */
  get element(): string {
    const system = ECSSystem.global();
    const registry = system.registry;
    const elementComp = registry.getComponent(this._entity, ElementComponent);
    return elementComp?.data.symbol || '';
  }

  /**
   * Set the element symbol of this atom
   */
  set element(symbol: string) {
    const system = ECSSystem.global();
    const registry = system.registry;
    registry.removeComponent(this._entity, ElementComponent);
    registry.addComponent(this._entity, ElementComponent, { symbol });
  }

  /**
   * Get the position of this atom
   */
  get position(): Position {
    const system = ECSSystem.global();
    const registry = system.registry;
    const positionComp = registry.getComponent(this._entity, PositionComponent);
    return positionComp?.data || { x: 0, y: 0, z: 0 };
  }

  /**
   * Set the position of this atom
   */
  set position(position: Position) {
    const system = ECSSystem.global();
    const registry = system.registry;
    registry.removeComponent(this._entity, PositionComponent);
    registry.addComponent(this._entity, PositionComponent, position);
  }

  /**
   * Get the structure ID this atom belongs to (if any)
   */
  get structureId(): number | undefined {
    const system = ECSSystem.global();
    const registry = system.registry;
    const structComp = registry.getComponent(this._entity, StructIDComponent);
    return structComp?.data.id;
  }

  /**
   * Set the structure ID this atom belongs to
   */
  setStructureId(id: number): void {
    const system = ECSSystem.global();
    const registry = system.registry;
    
    if (registry.hasComponent(this._entity, StructIDComponent)) {
      registry.removeComponent(this._entity, StructIDComponent);
    }
    registry.addComponent(this._entity, StructIDComponent, { id });
  }

  /**
   * Remove structure association from this atom
   */
  removeFromStructure(): void {
    const system = ECSSystem.global();
    const registry = system.registry;
    registry.removeComponent(this._entity, StructIDComponent);
  }

  /**
   * Destroy this atom and remove it from the registry
   */
  destroy(): void {
    const system = ECSSystem.global();
    const registry = system.registry;
    registry.removeEntity(this._entity);
  }
}
