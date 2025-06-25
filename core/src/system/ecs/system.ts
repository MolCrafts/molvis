import { Registry } from './registry';

/**
 * System class - Global ECS system manager
 * Provides a singleton registry for the entire application
 * Similar to entt's registry but with global access pattern
 */
export class System {
  private static _instance: System | undefined;
  private _registry: Registry;

  private constructor() {
    this._registry = new Registry();
  }

  /**
   * Get the global System instance (lazy singleton)
   */
  static global(): System {
    if (!System._instance) {
      System._instance = new System();
    }
    return System._instance;
  }

  /**
   * Get the registry for direct access
   */
  get registry(): Registry {
    return this._registry;
  }

  /**
   * Reset the global instance (useful for testing)
   */
  static reset(): void {
    if (System._instance) {
      System._instance._registry.clear();
      System._instance = undefined;
    }
  }

  /**
   * Clear all entities and components in the current registry
   */
  clear(): void {
    this._registry.clear();
  }
}
