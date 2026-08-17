/**
 * Yield the main thread so React / paint / input can run between heavy
 * synchronous WASM or JS chunks.
 *
 * Prefer `scheduler.yield` when present (Chrome), then MessageChannel
 * (macrotask, more reliable than `setTimeout(0)` under load), then
 * `setTimeout(0)`.
 *
 * For status text that **must** paint before a multi-second WASM call, use
 * {@link yieldForPaint} instead — this helper alone may resume before React
 * commits.
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
      ch.port1.onmessage = () => {
        // Close both ends: an open port keeps Node's event loop alive forever.
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Wait until after the next paint (rAF + macrotask). Use before long sync
 * WASM so the status bar / progress can actually update to the line you just
 * emitted — {@link yieldToUi} alone often races the paint.
 */
export function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      // One more macrotask so React's commit from the prior status update
      // can flush before we re-enter heavy sync work.
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => done());
    } else {
      done();
    }
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
