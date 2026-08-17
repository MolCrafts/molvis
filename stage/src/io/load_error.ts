/**
 * Normalize errors thrown by molrs WASM readers and JS load plumbing.
 *
 * wasm-bindgen maps `Result::Err(JsValue::from_str(...))` to a **raw string
 * throw** (not an `Error`). Callers that only check `instanceof Error` then
 * drop the molrs message and show a generic "Failed to load …". Always run
 * through {@link toIoError} before rethrowing or reporting to the UI.
 */

/** Turn any thrown value into an `Error` with a stable, user-visible message. */
export function toIoError(err: unknown, context?: string): Error {
  const detail = extractMessage(err);
  if (!context) {
    return err instanceof Error ? err : new Error(detail);
  }
  if (err instanceof Error && err.message.startsWith(context)) {
    return err;
  }
  // Avoid "context: context: detail" when the inner error already prefixes.
  if (detail.startsWith(context)) {
    return err instanceof Error ? err : new Error(detail);
  }
  return new Error(`${context}: ${detail}`, {
    cause: err instanceof Error ? err : undefined,
  });
}

/** Best-effort string from Error / string / wasm JsValue throws. */
export function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    // RuntimeError: unreachable — keep the name so users see it is a trap.
    if (err.name && err.name !== "Error" && !err.message.includes(err.name)) {
      return `${err.name}: ${err.message}`;
    }
    return err.message || err.name || String(err);
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}
