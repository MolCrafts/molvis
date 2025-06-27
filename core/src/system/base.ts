import type { Vector3 } from "@babylonjs/core";
import { ECSSystem, type Entity as ECSEntity } from "./ecs";

export type IProp = number | string | Vector3 | boolean;

export interface IEntity {
    get(key: string): IProp;
}

export class Entity<T = IProp> {
    protected readonly _data: Record<string, T>;
    protected readonly _ecsEntity: ECSEntity;
  
  constructor(data: Record<string, T>) {
    this._data = Object.freeze({ ...data });
    // Automatically register with ECS system
    const ecsSystem = ECSSystem.global();
    this._ecsEntity = ecsSystem.registry.createEntity();
  }
  
    /**
     * Get the ECS entity identifier for this entity
     */
    get ecsEntity(): ECSEntity {
      return this._ecsEntity;
    }

    public get(key: string): T {
      const val = this._data[key];
      return val;
    }
  
    public has(key: string): boolean {
      return key in this._data;
    }
  
    public keys(): string[] {
      return Object.keys(this._data);
    }
  
    public entries(): [string, T][] {
      return Object.entries(this._data);
    }
  
    public toJSON(): Record<string, T> {
      return { ...this._data };
    }
  
    /**
     * Get the internal data as read-only access
     */
    public get data(): Readonly<Record<string, T>> {
      return this._data;
    }
  
    /**
     * Immutable update: returns a new instance with updated key
     */
    public with(key: string, value: T): this {
      const newData = { ...this._data, [key]: value };
      return new (this.constructor as new (data: Record<string, T>) => this)(newData);
    }

    /**
     * Destroy this entity and remove it from ECS
     */
    public destroy(): void {
      const ecsSystem = ECSSystem.global();
      ecsSystem.registry.removeEntity(this._ecsEntity);
    }
  }
