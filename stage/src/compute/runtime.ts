/**
 * Main-thread lifecycle for the shared compute worker.
 *
 * Spawning needs no host wiring: {@link spawnComputeWorker} uses the static
 * `new Worker(new URL("./worker.js", import.meta.url))` form, which every
 * rspack-based host folds into its own build (same pattern as the trajectory
 * worker) — the one exception is the VS Code webview, which builds the worker
 * separately and swaps the spawn module out at build time (see `./spawn`).
 * Tests inject a fake host via {@link setComputeRuntimeForTests}.
 * Domain adapters (e.g. `optimize/worker_client`) build on this module —
 * never the other way around.
 */

import {
  createWorkloadSingleton,
  WorkloadHost,
} from "@molcrafts/molvis-core/workload";
import type { ComputeJob, ComputeProgress, ComputeResult } from "./protocol";
import { spawnComputeWorker } from "./spawn";

/** The workload host specialized to this package's compute job envelope. */
export type ComputeWorkloadHost = WorkloadHost<
  ComputeJob,
  ComputeResult,
  ComputeProgress
>;

/** Status-line beat while waiting for worker boot, so the UI looks alive. */
const HEARTBEAT_MS = 2_000;
/**
 * Fail fast on a broken worker URL / chunk. Boot includes the molrs WASM
 * fetch (cached after the main bundle loads it), so allow a slow first hit.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * Await the worker's boot handshake, beating a status line while it takes.
 *
 * Every domain adapter (optimize, analysis) needs the same wait: `whenReady()`
 * — resolved once the worker has loaded its modules and its WebAssembly and
 * posted `ready` — raced against a hard timeout, with a periodic beat so a slow
 * first boot never looks frozen. `onBeat` renders one status line; the caller
 * decides which of its own progress shapes carries it.
 *
 * The first beat is only due after 2 s, so an already-warm host resolves without
 * ever calling `onBeat`: a second job reports nothing but its own progress.
 * Boot is per host, not per job — this only waits, it never spawns.
 *
 * @param host the compute host to wait on (see {@link getComputeRuntime})
 * @param onBeat renders the current boot status line; called repeatedly until
 *   the worker is ready
 * @throws Error when the worker does not post `ready` within 30 s
 */
export async function awaitComputeHostReady(
  host: ComputeWorkloadHost,
  onBeat: (message: string) => void,
): Promise<void> {
  const hb = setInterval(
    () => onBeat("Starting compute worker…"),
    HEARTBEAT_MS,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      host.whenReady(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Compute worker failed to start (check worker URL / chunk). " +
                "See browser console for worker load errors.",
            ),
          );
        }, READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    clearInterval(hb);
  }
}

const singleton = createWorkloadSingleton<
  ComputeJob,
  ComputeResult,
  ComputeProgress
>(
  () =>
    new WorkloadHost({
      name: "molvis-compute",
      createWorker: spawnComputeWorker,
    }),
);

/**
 * The process-wide compute host, spawning the worker on first use.
 *
 * Cheap to call per job — the same host is returned until it dies (worker
 * error or `dispose()`), in which case the next call spawns a replacement.
 */
export function getComputeRuntime(): ComputeWorkloadHost {
  return singleton.get();
}

/**
 * Swap in a fake host so unit tests never spawn a real worker or load WASM.
 * Disposes whatever host was installed before; pass `null` to restore lazy
 * spawning of the real one.
 */
export function setComputeRuntimeForTests(
  host: ComputeWorkloadHost | null,
): void {
  singleton.setForTests(host);
}

/**
 * Spawn the compute worker when the user opens Optimize / Compute.
 * The worker's `ready` arrives after its module graph + molrs WASM are
 * live, so a warmed worker starts the first job immediately.
 *
 * Idempotent: later calls await the same already-live worker. The promise
 * rejects if the worker fails to boot (bad worker chunk / URL), so a warm-up
 * that only wants to hide latency should ignore the rejection rather than
 * surface it as a job failure.
 */
export function warmComputeWorker(): Promise<void> {
  return getComputeRuntime().whenReady();
}
