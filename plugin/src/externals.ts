/**
 * Host modules every page plugin must externalize at build time.
 *
 * The host loader injects the same bare specifiers. Both directions fail:
 * - externalized but not injected → bare specifier fails at runtime
 * - injected but not externalized → second copy of react/molrs/WASM
 *
 * The host's inject map is checked against this list at compile time
 * (`page/src/plugins/host_shared.ts`), so drift is a type error, not a
 * runtime surprise.
 *
 * Import via `@molcrafts/molvis/plugin` (or `@molcrafts/molvis-plugin`).
 */
export const PLUGIN_HOST_MODULE_IDS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@molcrafts/molvis-core/molrs",
  "@molcrafts/molvis-core/keys",
  "@molcrafts/molvis-core/elements",
  "@molcrafts/molplot",
  "@molcrafts/molvis-stage",
  // The SDK and its UI subpath are separate specifiers to a bundler, so both
  // must be listed — externalizing only the root left every plugin bundling
  // the shadcn primitives (measured: 160 kB vs 7.4 kB).
  "@molcrafts/molvis-plugin",
  "@molcrafts/molvis-plugin/ui",
  // The glTF (Graphics Language Transmission Format) exporter is its own
  // specifier, not part of the stage barrel: it drags @babylonjs/serializers
  // in, so the viewer graph must not reach it. The host injects this id
  // lazily (same bucket as molplot and the stage barrel).
  "@molcrafts/molvis-stage/export-gltf",
] as const;

export type PluginHostModuleId = (typeof PLUGIN_HOST_MODULE_IDS)[number];

/** rspack/rsbuild `externals` map (specifier → specifier). */
export const pluginExternals: Record<PluginHostModuleId, string> =
  Object.fromEntries(PLUGIN_HOST_MODULE_IDS.map((id) => [id, id])) as Record<
    PluginHostModuleId,
    string
  >;
