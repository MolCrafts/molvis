import type { Frame } from "@molcrafts/molrs";
import { logger } from "../../utils/logger";
import type { ModifierPipeline } from "../pipeline";
import type { AutoAttachableModifier } from "./auto_modifier";
import { AUTO_ATTACH_MODIFIERS } from "./registry";

/**
 * Walk the registered auto-attach modifier classes against `frame`
 * (typically frame 0 of a freshly-loaded trajectory) and instantiate
 * those whose `matches(frame)` predicate returns true.
 *
 * Returns the list of `autoAttachId`s that were attached so the caller
 * can persist this on the trajectory for UI / unload accounting.
 */
export function applyAutoAttach(
  pipeline: ModifierPipeline,
  frame: Frame,
  suppressedIds?: ReadonlySet<string>,
): readonly string[] {
  const attached: string[] = [];
  for (const Cls of AUTO_ATTACH_MODIFIERS) {
    if (suppressedIds?.has(Cls.autoAttachId)) continue;
    if (!safeMatches(Cls, frame)) continue;
    pipeline.addModifier(new Cls());
    attached.push(Cls.autoAttachId);
    logger.info(`[auto-attach] attached ${Cls.autoAttachId}`);
  }
  return attached;
}

/** A misbehaving `matches()` that throws would otherwise abort the
 *  whole load path. Catch and log; treat the entry as a no-match. */
function safeMatches(Cls: AutoAttachableModifier, frame: Frame): boolean {
  try {
    return Cls.matches(frame);
  } catch (err) {
    logger.warn(
      `[auto-attach] ${Cls.autoAttachId}.matches threw; skipping`,
      err as Error,
    );
    return false;
  }
}
