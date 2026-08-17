import type { PipelineEntry } from "./entry";

/**
 * The connection to a driving process — a Python session, or any other
 * controller speaking the JSON-RPC catalog over a WebSocket.
 *
 * The third kind of {@link PipelineEntry}, and the one that neither
 * contributes nor transforms data: a {@link DataSource} hands the composition
 * head a `Trajectory`, a `Modifier` rewrites a `Frame`, and a Session does
 * neither. What it carries is **authority** — the controller behind it can
 * clear the pipeline, move the camera, take a snapshot, change the mode. That
 * is why it is an entry rather than a source with an empty trajectory: "a
 * source that provides no data" is the same lie the old identity-`apply()`
 * source was, told in a new place.
 *
 * It lives in the list because the operator needs to see it and act on it —
 * a live resource belongs beside the other live resources, not buried in a
 * settings dialog. Its position in the list carries no meaning; it is not on
 * the data path at all.
 *
 * **Exactly one may exist.** {@link ModifierPipeline.setSession} replaces
 * rather than appends, so the cardinality is structural instead of a runtime
 * check someone has to remember to write.
 *
 * Two behaviours are deliberate and are not defaults inherited from the other
 * entry kinds:
 *
 * - **Removing it disconnects.** There is nothing else it could mean.
 * - **Disabling it must answer, not go quiet.** The RPC catalog is not all
 *   notifications: `snapshot.take`, `scene.export_frame`, `state.get` and
 *   friends are request/response, and Python blocks on them. A disabled
 *   session that silently drops a request leaves the caller waiting out a
 *   timeout and reading it as a dead network. It replies with an error
 *   instead, so the caller learns it was a switch they flipped.
 */
export class Session implements PipelineEntry {
  /**
   * Whether the session answers requests. `false` keeps the socket but makes
   * every inbound request fail fast — see the class doc for why silence is not
   * an option.
   */
  public enabled = true;

  /**
   * @param id      Assigned by the pipeline on insert.
   * @param address The controller's WebSocket URL, shown in the list.
   * @param disconnect Tears down the transport. Invoked by {@link onRemoved};
   *   removal *is* disconnection.
   */
  constructor(
    public readonly id: string,
    public readonly address: string,
    private readonly disconnect: () => void,
  ) {}

  get name(): string {
    return "Session";
  }

  /**
   * Removing the entry closes the connection. Unlike `DataSource.dispose`,
   * this runs from `onRemoved` directly: there is no ordering hazard to
   * sequence around — no other object holds a borrowed handle to it.
   */
  onRemoved(): void {
    this.disconnect();
  }
}
