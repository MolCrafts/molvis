import type { Frame } from "@molcrafts/molrs";
import type { Modifier } from "../modifier";

/**
 * Class-side contract for modifiers that opt into auto-attachment.
 *
 * A modifier "opts in" by declaring a static `matches(frame)` predicate
 * on its class. When a trajectory loads, the streaming runtime walks
 * every registered class, calls `matches(frame0)`, and if it returns
 * `true`, instantiates the modifier and attaches it to the pipeline.
 *
 * This is a CLASS-side type (constructor + statics), not an instance
 * type — the modifier instances themselves still implement
 * {@link Modifier}, this just describes the class object.
 */
export interface AutoAttachableModifier {
  /** Identifies the modifier class for de-dup / suppression bookkeeping.
   *  Stable across reloads — the loader uses it to skip re-attaching
   *  a modifier the user has explicitly removed in the same session. */
  readonly autoAttachId: string;

  /** Cheap predicate against a representative frame (typically frame 0).
   *  MUST NOT mutate the frame. Throws are caught upstream and treated
   *  as no-match. */
  matches(frame: Frame): boolean;

  /** Constructor — invoked when `matches` returns true. */
  new (): Modifier;
}
