import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { Trajectory } from "../system/trajectory";
import { DataSource, type DataSourceOptions } from "./data_source";

/** How a stream acquires its socket. */
export type StreamMode = "dial";

export interface StreamDataSourceOptions extends DataSourceOptions {
  /**
   * How many frames to keep. `0` (the default) keeps everything, which is
   * right for a run you intend to scrub through and wrong for one that never
   * ends. See {@link StreamDataSource.getFrame} for what eviction does to
   * indices.
   */
  maxFrames?: number;
  /** Wire encoding the producer writes. Must match its `MessageFormat`. */
  format?: "msgpack" | "json";
}

/**
 * A {@link DataSource} fed by a live producer over a WebSocket.
 *
 * The producer binds (`molrs::stream::FrameServer`) and this dials it. That
 * orientation is deliberate: a run that takes hours outlives any one viewer, so
 * the long-lived end should be the one holding the port — a page reload
 * re-attaches instead of killing the stream, and more than one viewer can watch
 * the same run. The reverse (viewer binds, producer pushes) suits a short
 * script better, which is why {@link StreamMode} is a field rather than an
 * assumption; there is only one member today because there is only one
 * deployment shape asking for it.
 *
 * Frames are decoded by molrs, never here: `readFrameBytes` owns the wire
 * format, and re-deriving the layout in TypeScript is how the two ends drift
 * apart.
 *
 * ## Indices
 *
 * This is the one place a push source does not fit the pull interface
 * cleanly. `DataSource.getFrame(index)` is random access, but a stream only
 * ever grows at the tail and — under {@link StreamDataSourceOptions.maxFrames}
 * — shrinks at the head. So **an index is a position in the retained window,
 * not a step number**: once eviction starts, index 0 stops meaning "the first
 * frame the producer sent". `frameCount` is the retained count for the same
 * reason.
 *
 * The alternative — keeping absolute indices and throwing on an evicted one —
 * was rejected: the pipeline computes at whatever index the timeline holds, so
 * a throw there is a broken scene rather than a handled edge. Following the
 * tail, which is what a live view does, is unaffected either way.
 */
export class StreamDataSource extends DataSource {
  readonly kind = "stream" as const;
  readonly mode: StreamMode = "dial";

  private readonly _trajectory = new Trajectory();
  private readonly _maxFrames: number;
  private readonly _format: "msgpack" | "json";
  private _cached: Frame | null = null;
  private _socket: WebSocket | null = null;
  private _closed = false;

  /** Frames dropped to stay within {@link StreamDataSourceOptions.maxFrames}. */
  public evicted = 0;

  constructor(
    readonly address: string,
    options: StreamDataSourceOptions = {},
  ) {
    super("stream-data-source", "Stream");
    this._maxFrames = Math.max(0, options.maxFrames ?? 0);
    this._format = options.format ?? "msgpack";
    if (options.filename !== undefined) this.filename = options.filename;
    else this.filename = address;
    this.sourceType = options.sourceType ?? "backend";
    if (options.contributedBlocks !== undefined) {
      this.contributedBlocks = options.contributedBlocks;
    }
  }

  get trajectory(): Trajectory {
    return this._trajectory;
  }

  get frameCount(): number {
    return this._trajectory.length;
  }

  /** See the class doc: `index` addresses the retained window. */
  getFrame(index: number): Promise<Frame> {
    return this._trajectory.frame(index);
  }

  async preload(index: number): Promise<void> {
    if (index < 0 || index >= this._trajectory.length) {
      throw new Error(
        `StreamDataSource ${this.id}: frame index ${index} out of the retained window [0, ${this._trajectory.length})`,
      );
    }
    this._cached = await this._trajectory.frame(index);
  }

  get cachedFrame(): Frame {
    if (this._cached === null) {
      throw new Error(
        `StreamDataSource ${this.id}: cachedFrame accessed before preload()`,
      );
    }
    return this._cached;
  }

  get peekFrame(): Frame | undefined {
    return this._cached ?? undefined;
  }

  /**
   * Append a decoded frame, evicting from the head when the retention cap is
   * exceeded. Separate from the socket so the growth policy is testable
   * without a network.
   */
  push(frame: Frame, box?: Box): number {
    this._trajectory.addFrame(frame, box);
    if (this._maxFrames > 0) {
      while (this._trajectory.length > this._maxFrames) {
        this._trajectory.dropOldestFrame();
        this.evicted++;
      }
    }
    return this._trajectory.length - 1;
  }

  /**
   * Decode one wire payload and append it.
   *
   * Throws rather than swallowing: a payload this source cannot read is a
   * version mismatch with the producer, not a dropped frame, and a stream that
   * silently ingests nothing is the hardest kind of failure to diagnose.
   */
  async ingest(payload: Uint8Array): Promise<number> {
    const molrs = (await import("@molcrafts/molvis-core/molrs")) as unknown as {
      readFrameBytes?: (data: Uint8Array, format: string) => Frame;
    };
    if (typeof molrs.readFrameBytes !== "function") {
      throw new Error(
        "This molrs build has no readFrameBytes, so a molrs stream cannot be " +
          "decoded. Upgrade @molcrafts/molrs to the release that ships it.",
      );
    }
    return this.push(molrs.readFrameBytes(payload, this._format));
  }

  /** Open the socket. Idempotent; a second call is a no-op. */
  connect(onFrame?: (index: number) => void): void {
    if (this._socket !== null || this._closed) return;
    const socket = new WebSocket(this.address);
    socket.binaryType = "arraybuffer";
    socket.onmessage = (ev) => {
      const payload =
        ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : new TextEncoder().encode(String(ev.data));
      void this.ingest(payload).then(onFrame);
    };
    this._socket = socket;
  }

  dispose(): void {
    this._closed = true;
    this._socket?.close();
    this._socket = null;
    this._trajectory.dispose();
    this._cached = null;
  }
}
