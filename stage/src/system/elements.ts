/**
 * Re-export shared element catalog from workspace core.
 * Call sites may keep importing from `../system/elements` or relative paths.
 */
export {
  getVanDerWaalsRadius,
  type IElement,
  isMetalElement,
  normalizeElement,
  PeriodicTable,
  type TPeriodicTable,
  VanDerWaalsRadii,
} from "@molcrafts/molvis-core/elements";
