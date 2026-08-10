/**
 * Shared compute-worker job envelope.
 *
 * One Dedicated Worker hosts all heavy molrs workloads (optimize today,
 * analysis next). Domain payloads stay in their own modules; this file only
 * discriminates job kinds.
 */

import type {
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
} from "../optimize/protocol";

export type ComputeJob = { kind: "optimize"; payload: OptimizeJobPayload };

export type ComputeResult = { kind: "optimize"; result: OptimizeJobResult };

export type ComputeProgress = {
  kind: "optimize";
  progress: OptimizeProgress;
};
