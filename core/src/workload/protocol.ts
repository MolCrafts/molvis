/**
 * Generic dedicated-worker workload envelope.
 *
 * Domain jobs (optimize, analysis, …) plug their own `TJob` /
 * `TResult` / `TProgress` — this module only owns id-correlated messaging,
 * cancel, and the ready handshake.
 */

/** Main → worker: start a job, or ask a running one to stop. */
export type WorkloadRequest<TJob = unknown> =
  | { type: "run"; id: number; job: TJob }
  | { type: "cancel"; id: number };

/**
 * Worker → main. `ready` is the one-off boot handshake and carries no id;
 * every other message is correlated by the id of the `run` that started it.
 * By convention a cancelled job answers `done` with whatever partial result it
 * reached, so `error` stays reserved for genuine failures.
 */
export type WorkloadResponse<TResult = unknown, TProgress = unknown> =
  | { type: "ready" }
  | { type: "progress"; id: number; progress: TProgress }
  | { type: "done"; id: number; result: TResult }
  | { type: "error"; id: number; message: string };

/**
 * Narrow an unknown `message` event payload to a {@link WorkloadResponse}.
 *
 * A tag check only: it proves the message came from this envelope, not that
 * `id` / `result` / `progress` are present or well-typed. Domain code still
 * validates its own payload.
 */
export function isWorkloadResponse(msg: unknown): msg is WorkloadResponse {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return t === "ready" || t === "progress" || t === "done" || t === "error";
}
