/**
 * SerialQueue — runs asynchronous tasks one at a time, in the order they were
 * queued.
 *
 * The WebSocket bridge handles every inbound message in an async listener.
 * Without a queue, two messages run concurrently: a `snapshot.take` sent after
 * a fire-and-forget `draw_frame` or `mark_atom` could capture the canvas
 * before those earlier commands finished, so the controller saw a picture
 * that did not reflect what it had sent. Each message is queued here instead,
 * so a reply always reflects every command sent before it.
 *
 * A task that throws does not stop the queue: its rejection is reported
 * through `onError` and the next task runs.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /** `onError` receives the error of a task that threw. */
  constructor(private readonly onError: (error: unknown) => void) {}

  /** Queue `task` behind every task queued before it. */
  run(task: () => Promise<void>): Promise<void> {
    const next = this.tail.then(task).catch(this.onError);
    this.tail = next;
    return next;
  }
}
