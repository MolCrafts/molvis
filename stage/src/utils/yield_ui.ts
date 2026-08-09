/**
 * Yield the main thread so React / paint / input can run between heavy
 * synchronous WASM or JS chunks.
 *
 * Prefer `scheduler.yield` when present (Chrome), then MessageChannel
 * (macrotask, more reliable than `setTimeout(0)` under load), then
 * `setTimeout(0)`.
 */
export function yieldToUi(): Promise<void> {
  const sched = (
    globalThis as {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof sched?.yield === "function") {
    return sched.yield();
  }
  if (typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Best-effort free for molrs WASM handles that may already be poisoned. */
export function safeFree(obj: { free?: () => void } | null | undefined): void {
  if (!obj || typeof obj.free !== "function") return;
  try {
    obj.free();
  } catch {
    /* already freed / RefCell poisoned after a WASM panic */
  }
}
