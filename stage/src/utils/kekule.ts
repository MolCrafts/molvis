/**
 * Thin face over molrs {@link Perceive.findKekuleOrders}.
 *
 * Chemistry lives in molrs — this module does not reimplement Kekulé matching.
 * Call at structure ingress so `bond_number` is a legal Lewis phase on aromatic
 * bonds (`bond_type=4`) before stick rendering or BondMeta capture.
 */

import { type Frame, Perceive } from "@molcrafts/molvis-core/molrs";

/**
 * Return a frame whose aromatic bonds have localized `bond_number` (1|2|…).
 *
 * Always returns a **new** Frame (molrs graph-in / graph-out). Callers that
 * own `frame` must free either the input or the result according to their
 * ownership rules — never free both.
 *
 * Frames with no aromatic bonds (or already filled numbers) come back with
 * the same chemistry; still a new handle.
 */
export function withKekuleOrders(frame: Frame): Frame {
  return new Perceive().findKekuleOrders(frame);
}
