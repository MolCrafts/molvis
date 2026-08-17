/**
 * The plugin id namespace convention, in one place.
 *
 * Host and engine both need to recognise namespaced contribution ids
 * (`plugin.<pluginId>.<localId>`). Before this module the `"plugin."`
 * literal and the `.`-splitting rule were re-typed at every call site,
 * so a change to the scheme could not be made in one edit.
 */

/** Prefix every namespaced plugin contribution id carries. */
export const PLUGIN_ID_PREFIX = "plugin.";

/** Segment separator inside a namespaced id. */
export const PLUGIN_ID_SEPARATOR = ".";

/** True when `id` is already namespaced by {@link namespacePluginId}. */
export function isNamespacedPluginId(id: string): boolean {
  return id.startsWith(PLUGIN_ID_PREFIX);
}

/**
 * Namespace a plugin-local id.
 *
 * Only an id that already carries {@link PLUGIN_ID_PREFIX} is passed through
 * — "contains a dot" is **not** treated as evidence of namespacing. Dotted
 * local ids are idiomatic (`io.load`, `settings.about`, and the docs' own
 * `plugin.com.example.python`), so the dot heuristic silently skipped
 * namespacing for exactly the ids most likely to collide between plugins.
 */
export function namespacePluginId(
  pluginId: string,
  localId: string,
  separator: string = PLUGIN_ID_SEPARATOR,
): string {
  if (isNamespacedPluginId(localId)) return localId;
  return `${PLUGIN_ID_PREFIX}${pluginId}${separator}${localId}`;
}

/**
 * Last segment of a (possibly namespaced) id — the part meant for humans
 * when no explicit label was supplied.
 *
 * `plugin.com.example.python` → `python`; `view` → `view`.
 */
export function pluginIdLeaf(id: string): string {
  const leaf = id.split(PLUGIN_ID_SEPARATOR).pop();
  return leaf && leaf.length > 0 ? leaf : id;
}
