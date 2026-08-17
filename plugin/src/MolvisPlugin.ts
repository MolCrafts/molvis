/**
 * OOP base for MolVis page plugins.
 *
 * Domain registration stays in small `register(api)` functions. Subclass
 * only owns identity + activate/deactivate wiring.
 *
 * ```ts
 * import { MolvisPlugin, type PluginAPI } from "@molcrafts/molvis/plugin";
 *
 * export default class MyPlugin extends MolvisPlugin {
 *   readonly id = "com.example.my-plugin";
 *   readonly name = "My Plugin";
 *   readonly version = "0.1.0";
 *   activate(api: PluginAPI) { ... }
 * }
 * ```
 */

import type { MolvisPluginModule, PluginAPI } from "./contract";

export abstract class MolvisPlugin implements MolvisPluginModule {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;

  abstract activate(api: PluginAPI): void | Promise<void>;

  deactivate(_api: PluginAPI): void | Promise<void> {
    /* default: no-op */
  }
}
