/**
 * Test double for {@link PluginAPI}.
 *
 * Plugin tests used to hand-write a partial `PluginAPI` literal, which only
 * compiled because each repo's contract copy had been trimmed to whatever
 * that test happened to implement. Building the double from the real
 * contract means a new domain shows up as a compile error in one place here
 * rather than silently passing everywhere.
 */

import type { PluginAPI, PluginStorage } from "./contract";

/** In-memory {@link PluginStorage}, so tests can assert on persistence. */
export function mapStorage(backing = new Map<string, string>()): PluginStorage {
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
}

/**
 * A complete no-op `PluginAPI`. Pass `overrides` to record the calls a test
 * cares about; every other domain stays a silent stub.
 *
 * `app` defaults to `null` cast to the engine type: no test in a plugin repo
 * can build a real `Molvis`, and the alternative — typing `app` loosely in
 * the contract — is what let `app: unknown` leak into a published surface.
 */
export function fakePluginAPI(overrides: Partial<PluginAPI> = {}): PluginAPI {
  return {
    app: null as unknown as PluginAPI["app"],
    pluginId: "com.example.test",
    log: { info() {}, warn() {}, error() {} },
    storage: mapStorage(),
    modifiers: { register() {} },
    modes: { register() {}, registerToolsPanel() {} },
    analysis: { register() {} },
    commands: { register() {} },
    dialogs: { register() {} },
    panels: { register() {} },
    overlays: { add() {} },
    settings: { registerSection() {} },
    caches: { register() {} },
    rpc: { registerMethod() {} },
    ...overrides,
  };
}
