import { SketchRpcError } from "./board_rpc";

/** The subset of `WebSocket` the bridge uses; tests pass a fake. */
export interface BridgeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

/** What answers requests: `SketchBoardRpc` in the page. */
export interface RequestExecutor {
  execute(method: string, params: unknown): Promise<unknown>;
}

/** Where the Python transport is and how to authenticate to it. */
export interface BridgeEndpoint {
  wsUrl: string;
  token: string;
  session: string;
}

const INTERNAL_ERROR = -32603;
const INVALID_REQUEST = -32600;

/**
 * The sketch page's end of `molvis.transport.WebSocketTransport`.
 *
 * Same protocol as the stage page: send `{type: "hello", token, session}`,
 * wait for `{type: "ready"}`, then answer JSON-RPC 2.0 requests. Requests run
 * strictly one after another, in arrival order, so a `sketch.load` followed by
 * `sketch.export_svg` always exports the loaded document. The sketch protocol
 * is JSON only; a binary frame is answered with an error, never guessed at.
 */
/** What the bridge is doing, for a page that shows it. */
export type BridgeStatus =
  | { kind: "connecting" }
  | { kind: "ready" }
  | { kind: "closed"; code?: number; reason?: string };

export class SketchPageBridge {
  private socket: BridgeSocket | null = null;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly endpoint: BridgeEndpoint,
    private readonly executor: RequestExecutor,
    private readonly openSocket: (url: string) => BridgeSocket,
    private readonly onStatus: (status: BridgeStatus) => void = () => {},
  ) {}

  /**
   * The endpoint a page URL names (`?ws_url=…&token=…&session=…`, the query
   * `WebSocketTransport.page_endpoints` builds), or `null` without `ws_url`.
   */
  static readEndpoint(search: string): BridgeEndpoint | null {
    const params = new URLSearchParams(search);
    const wsUrl = params.get("ws_url");
    if (!wsUrl) return null;
    return {
      wsUrl,
      token: params.get("token") ?? "",
      session: params.get("session") ?? "default",
    };
  }

  /** Whether the hello handshake has completed. */
  get isReady(): boolean {
    return this.ready;
  }

  connect(): void {
    if (this.socket) return;
    const socket = this.openSocket(this.endpoint.wsUrl);
    this.socket = socket;
    this.onStatus({ kind: "connecting" });
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          token: this.endpoint.token,
          session: this.endpoint.session,
        }),
      );
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = (event) => {
      this.ready = false;
      this.socket = null;
      const { code, reason } = (event ?? {}) as {
        code?: number;
        reason?: string;
      };
      this.onStatus({
        kind: "closed",
        ...(code !== undefined && { code }),
        ...(reason && { reason }),
      });
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") {
      this.reply({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: INVALID_REQUEST,
          message: "the sketch page speaks JSON text frames only",
        },
      });
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (!this.ready) {
      if (record.type === "ready") {
        this.ready = true;
        this.onStatus({ kind: "ready" });
      }
      return;
    }
    if (typeof record.method !== "string") return;
    const id = record.id;
    // Notifications (no id) get no reply, per JSON-RPC 2.0.
    this.queue = this.queue.then(() =>
      this.run(record.method as string, record.params, id),
    );
  }

  private async run(
    method: string,
    params: unknown,
    id: unknown,
  ): Promise<void> {
    try {
      const result = await this.executor.execute(method, params);
      if (id !== undefined) this.reply({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (id === undefined) return;
      const code =
        error instanceof SketchRpcError ? error.code : INTERNAL_ERROR;
      const message = error instanceof Error ? error.message : String(error);
      this.reply({ jsonrpc: "2.0", id, error: { code, message } });
    }
  }

  private reply(payload: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(payload));
  }
}
