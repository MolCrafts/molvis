/**
 * VS Code webview replacement for stage's `compute/spawn`.
 *
 * Wired via `NormalModuleReplacementPlugin` in the webview rslib configs so
 * the main-thread graph never folds the compute worker into splitChunks
 * (dual chunk ownership). The worker is a separate rslib entry
 * (`rslib.webview.worker.config.mts` → `out/chunks/compute-worker.js`),
 * colocated with the shared chunks.
 */

export function spawnComputeWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Compute worker: Worker is not available");
  }
  // Non-literal path: bundlers must not treat this as a worker entry to fold
  // into the main graph. Resolves relative to this module's chunk URL
  // (`…/chunks/*.js` → `…/chunks/compute-worker.js`).
  const workerScript = "./compute-worker.js";
  return new Worker(new URL(workerScript, import.meta.url), {
    type: "module",
    name: "molvis-compute",
  });
}
