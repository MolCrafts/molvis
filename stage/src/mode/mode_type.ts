/**
 * Interaction mode identifiers.
 *
 * Lives in a leaf module with no imports so callers such as `config.ts` can
 * read `ModeType` / {@link ALL_MODE_TYPES} at module init without hitting the
 * `mode/base` ↔ `app` ↔ `config` cycle (which left `ModeType` undefined and
 * made `Object.values(ModeType)` throw during webview load).
 */
export enum ModeType {
  View = "view",
  Select = "select",
  Edit = "edit",
  Measure = "measure",
  Manipulate = "manipulate",
}

/**
 * Any mode identifier the app accepts: a built-in {@link ModeType} or a
 * plugin-registered id such as `plugin.com.example.python`.
 *
 * The mode domain is open — plugins add members at runtime — so this is the
 * type to use anywhere a mode crosses an API boundary. `string & {}` keeps
 * editor completion for the built-ins while still admitting plugin ids,
 * which is what the `as ModeType` casts used to paper over.
 */
export type ModeId = ModeType | (string & {});

/**
 * Every mode, in documented keyboard / UI order.
 * Prefer this over `Object.values(ModeType)` — safer under bundler cycles.
 */
export const ALL_MODE_TYPES: readonly ModeType[] = [
  ModeType.View,
  ModeType.Select,
  ModeType.Edit,
  ModeType.Measure,
  ModeType.Manipulate,
];
