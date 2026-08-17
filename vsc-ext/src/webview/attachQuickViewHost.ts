/**
 * Normative host bridge for Quick View (stage-only surface).
 * Thin wrapper over {@link attachStageHost} — Workbench extends the same core.
 */

import type { Molvis } from "@molcrafts/molvis-stage";
import {
  type AttachStageHostOptions,
  attachStageHost,
  postStageReady,
  type StageHostHandle,
} from "./attachStageHost";

export type AttachQuickViewHostOptions = Omit<
  AttachStageHostOptions,
  "isHostMessage" | "onExtraMessage"
>;

export type QuickViewHostHandle = StageHostHandle;

export function attachQuickViewHost(
  app: Molvis,
  options: AttachQuickViewHostOptions,
): QuickViewHostHandle {
  return attachStageHost(app, options);
}

export { postStageReady as postQuickViewReady };
