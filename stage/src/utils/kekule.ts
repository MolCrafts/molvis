/**
 * Thin face over molrs {@link assignKekuleBondOrders}.
 *
 * Chemistry lives in molrs — this module does not reimplement Kekulé matching.
 * Call at structure ingress so `bond_number` is a legal Lewis phase on aromatic
 * bonds (`bond_type=4`) before stick rendering or BondMeta capture.
 */

import {
  assignKekuleBondOrders,
  type Frame,
} from "@molcrafts/molvis-core/molrs";

/**
 * Localize `bond_number` (1|2|…) on the aromatic bonds of `frame`.
 *
 * molrs edits the frame in place and reports whether any bond was aromatic.
 * The same handle comes back so callers free it once.
 *
 * Throws when molrs refuses the frame (e.g. a perceived `bond_number` that
 * contradicts the Frame schema).
 */
export function withKekuleOrders(frame: Frame): Frame {
  assignKekuleBondOrders(frame);
  return frame;
}
