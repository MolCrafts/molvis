/**
 * Shared compute-worker job envelope.
 *
 * One Dedicated Worker hosts all heavy molrs workloads (optimize, analysis).
 * Domain payloads stay in their own modules; this file only discriminates job
 * kinds.
 */

import type {
  AnalysisJobPayload,
  AnalysisJobProgress,
  AnalysisJobResult,
} from "../analysis/worker_protocol";
import type {
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
} from "../optimize/protocol";

/**
 * One unit of work for the compute worker, tagged by domain.
 *
 * Both kinds share the single worker, which runs them first-in-first-out, one at
 * a time — an analysis posted while an optimize job runs waits its turn.
 */
export type ComputeJob =
  | { kind: "optimize"; payload: OptimizeJobPayload }
  | { kind: "analysis"; payload: AnalysisJobPayload };

/** What a finished job answers with; `kind` echoes the job's own. */
export type ComputeResult =
  | { kind: "optimize"; result: OptimizeJobResult }
  | { kind: "analysis"; result: AnalysisJobResult };

/** Anything a running job streams back before it finishes. */
export type ComputeProgress =
  | { kind: "optimize"; progress: OptimizeProgress }
  | { kind: "analysis"; progress: AnalysisJobProgress };
