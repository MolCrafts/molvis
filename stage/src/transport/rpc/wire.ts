/**
 * Frame wire format — the one serialization for molecular data crossing the
 * JSON-RPC seam, in **both** directions.
 *
 * ## Nothing here is invented
 *
 * - **Column and block names** are molrs's. `molrs::core::keys` is the single
 *   source of truth (`x`/`y`/`z`, `element`, `type`, `charge`,
 *   `atomi`/`atomj`/`atomk`/`atoml`, …), read in Python as
 *   `molpy.core.keys`. This module therefore **never** renames,
 *   aliases, or requires a column name. Format-native spellings (`species`,
 *   `i`/`j`, `q`, `mol`) are translated by the molrs readers at the I/O
 *   boundary, which is the layer that owns that mapping — not this one.
 * - **dtype tags** identify the native-width carrier. Numeric columns travel
 *   as typed arrays or binary references; bool and string arrays travel inline.
 *   Each column has its own shape, independently of the block's grid shape.
 *
 * Columns with complex values, null rows, empty bool arrays, precision or target declarations
 * cannot be reconstructed by Block.set and are explicitly rejected.
 * All schema validation is owned by molrs.
 *
 * @module
 */

import {
  type Block,
  Box,
  Cell,
  type Column,
  Frame,
  type NumericColumn,
} from "@molcrafts/molvis-core/molrs";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

/** The dtype tags molrs-wasm can round-trip. */
export type WireDType =
  | "f64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "bool"
  | "string";

/** Marker key identifying a {@link BufferRef} inside a JSON payload. */
export const BUFFER_REF_MARKER = "__molvis_buffer__";

/**
 * Reference to a binary buffer carried alongside the JSON envelope.
 *
 * Used by the WebSocket transport, where dense numeric columns travel as raw
 * bytes rather than JSON number arrays. In-process transports (Pyodide) put the
 * typed array inline instead; {@link decodeFrame} accepts either.
 */
export interface BufferRef {
  readonly [BUFFER_REF_MARKER]: true;
  /** Index into the transport's buffer list. */
  readonly index: number;
}

/**
 * One column: a dtype tag plus its data.
 *
 * `data` is either the typed array itself (in-process) or a {@link BufferRef}
 * (WebSocket). String columns are always inline — JS has no string TypedArray.
 */
export type WireColumn = {
  dtype: WireDType;
  data: NumericColumn | boolean[] | string[] | BufferRef;
  /** Native column dimensions; absent only in legacy scalar payloads. */
  shape?: number[];
};

/**
 * One block: named columns, plus the block shape when it is not a flat table.
 *
 * `shape` maps to molrs `Block.setShape()` / `Block.structuralShape` —
 * `[32, 32, 32]` for a volumetric grid; absent for a flat table.
 */
export interface WireBlock {
  columns: Record<string, WireColumn>;
  shape?: number[];
}

/**
 * A simulation box.
 *
 * `h` is the 3×3 cell matrix whose **columns** are the lattice vectors `a`,
 * `b`, `c`, flattened **row-major**:
 *
 * ```text
 * h = [ax, bx, cx,
 *      ay, by, cy,
 *      az, bz, cz]
 * ```
 *
 * That is exactly `molpy.Box.matrix.ravel(order="C")` — the array is already
 * C-contiguous, so producers send it as-is — and exactly what molrs
 * `Cell.matrix` / `Box.h()` use. Encode and decode pass `h` through unchanged.
 */
export interface WireBox {
  h: Float64Array | BufferRef;
  origin: Float64Array | BufferRef;
  pbc: [boolean, boolean, boolean];
}

/** A frame: named blocks, an optional box, and scalar metadata. */
export interface WireFrame {
  blocks: Record<string, WireBlock>;
  box?: WireBox | null;
  /** Finite f64 scalars or exact 64-bit integers encoded as decimal text. */
  meta?: Record<string, number | { dtype: "i64" | "u64"; data: string }>;
}

/** A frame plus the binary buffers its {@link BufferRef}s point into. */
export interface EncodedFrame {
  frame: WireFrame;
  buffers: ArrayBuffer[];
}

// ---------------------------------------------------------------------------
//  Errors
// ---------------------------------------------------------------------------

/**
 * A wire payload that does not meet the contract.
 *
 * Always carries the `block.column` path so the producer can find what it sent
 * wrong. Transports map this to JSON-RPC `-32602 Invalid params`.
 */
export class WireError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "WireError";
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
//  Buffer resolution
// ---------------------------------------------------------------------------

function isBufferRef(value: unknown): value is BufferRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[BUFFER_REF_MARKER] === true
  );
}

/**
 * Resolve a column carrier to its typed array.
 *
 * A {@link BufferRef} is read from `buffers` with the constructor named by the
 * dtype tag — the tag decides how the bytes are interpreted, nothing else.
 */
function resolveCarrier(
  path: string,
  dtype: Exclude<WireDType, "string" | "bool">,
  data: unknown,
  buffers: readonly DataView[],
): NumericColumn {
  if (isBufferRef(data)) {
    const { index } = data;
    if (!Number.isInteger(index) || index < 0 || index >= buffers.length) {
      throw new WireError(
        path,
        `buffer index ${String(index)} is out of range (${buffers.length} buffer(s) received)`,
      );
    }
    const view = buffers[index];
    return viewAs(path, dtype, view);
  }

  const carrierType = CARRIERS[dtype];
  if (data instanceof carrierType) return data;
  throw new WireError(
    path,
    `dtype "${dtype}" requires a ${carrierType.name} or a buffer reference, received ${describe(data)}`,
  );
}

const CARRIERS = {
  f64: Float64Array,
  i8: Int8Array,
  i16: Int16Array,
  i32: Int32Array,
  i64: BigInt64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  u64: BigUint64Array,
} as const;

/** Reinterpret transport bytes as the typed array the dtype tag names. */
function viewAs(
  path: string,
  dtype: Exclude<WireDType, "string" | "bool">,
  view: DataView,
): NumericColumn {
  const carrierType = CARRIERS[dtype];
  const itemSize = carrierType.BYTES_PER_ELEMENT;
  if (view.byteLength % itemSize !== 0) {
    throw new WireError(
      path,
      `buffer of ${view.byteLength} byte(s) is not a whole number of ${dtype} values`,
    );
  }
  // A typed-array view demands element alignment; copy when the transport
  // handed us bytes that do not start on a boundary.
  const aligned =
    view.byteOffset % itemSize === 0
      ? { buffer: view.buffer as ArrayBuffer, offset: view.byteOffset }
      : {
          buffer: (view.buffer as ArrayBuffer).slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
          ),
          offset: 0,
        };
  const count = view.byteLength / itemSize;
  return new carrierType(aligned.buffer, aligned.offset, count);
}

/** molrs throws bare JS strings from wasm-bindgen as often as `Error`s. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a plain Array";
  const ctor = (value as { constructor?: { name?: string } })?.constructor
    ?.name;
  return ctor ? `a ${ctor}` : typeof value;
}

// ---------------------------------------------------------------------------
//  Decode — wire → molrs
// ---------------------------------------------------------------------------

/**
 * Write one column into a molrs block, dispatching on its declared dtype.
 *
 * Invariants molrs already owns — uniform row count within a block above all —
 * are left to molrs. This only re-labels its errors with the `block.column`
 * path, which molrs cannot know.
 */
function decodeColumn(
  block: Block,
  path: string,
  name: string,
  column: WireColumn,
  buffers: readonly DataView[],
): void {
  const shape =
    column.shape === undefined ? undefined : toShape(path, column.shape);
  let data: Column;
  if (column.dtype === "string" || column.dtype === "bool") {
    if (
      !Array.isArray(column.data) ||
      column.data.some(
        (item) =>
          typeof item !== (column.dtype === "bool" ? "boolean" : "string"),
      )
    ) {
      throw new WireError(
        path,
        `dtype "${column.dtype}" requires a ${column.dtype === "bool" ? "boolean" : "string"}[]`,
      );
    }
    data = column.data as boolean[] | string[];
  } else if (Object.hasOwn(CARRIERS, column.dtype)) {
    data = resolveCarrier(path, column.dtype, column.data, buffers);
  } else {
    throw new WireError(path, `unknown dtype ${JSON.stringify(column.dtype)}`);
  }
  block.set(name, data, shape);
  if (block.dtype(name) !== column.dtype) {
    throw new WireError(
      path,
      `native setter changed dtype ${column.dtype} to ${block.dtype(name)}; cannot preserve this column`,
    );
  }
}

function asRecord(
  value: unknown,
  path: string,
  what: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WireError(
      path,
      `${what} must be an object, received ${describe(value)}`,
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Build a molrs `Frame` from a wire payload.
 *
 * The returned frame owns WASM memory; the caller is responsible for `free()`
 * (or for handing it to a `Trajectory`, which owns it from then on).
 *
 * @throws {WireError} when a dtype tag is unknown, a carrier does not match its
 * tag, a buffer reference dangles, molrs rejects a column write, or
 * `frame.validate()` reports a schema violation.
 */
export function decodeFrame(
  payload: unknown,
  buffers: readonly DataView[] = [],
): Frame {
  const wire = asRecord(payload, "", "frame payload");
  const blocks = asRecord(wire.blocks, "", "frame 'blocks'");

  const frame = new Frame();
  try {
    for (const [blockName, rawBlock] of Object.entries(blocks)) {
      const blockRecord = asRecord(rawBlock, blockName, "block");
      const columns = asRecord(
        blockRecord.columns,
        blockName,
        "block 'columns'",
      );
      const block = frame.createBlock(blockName);

      for (const [columnName, rawColumn] of Object.entries(columns)) {
        const path = `${blockName}.${columnName}`;
        const column = asRecord(
          rawColumn,
          path,
          "column",
        ) as unknown as WireColumn;
        try {
          decodeColumn(block, path, columnName, column, buffers);
        } catch (error) {
          if (error instanceof WireError) throw error;
          // molrs rejected the column (row-count mismatch, bad shape, …).
          // Its message is the authority; we only add where it happened.
          throw new WireError(path, messageOf(error));
        }
      }

      if (blockRecord.shape !== undefined) {
        try {
          block.setShape(toShape(blockName, blockRecord.shape));
        } catch (error) {
          if (error instanceof WireError) throw error;
          throw new WireError(blockName, messageOf(error));
        }
      }
    }

    if (wire.box != null) {
      frame.box = decodeBox(wire.box, buffers);
    }

    if (wire.meta !== undefined) {
      const meta = asRecord(wire.meta, "", "frame 'meta'");
      for (const [name, value] of Object.entries(meta)) {
        if (typeof value === "object" && value !== null) {
          const integer = asRecord(value, `meta.${name}`, "integer metadata");
          if (
            (integer.dtype !== "i64" && integer.dtype !== "u64") ||
            typeof integer.data !== "string" ||
            !/^-?(0|[1-9][0-9]*)$/.test(integer.data)
          ) {
            throw new WireError(
              `meta.${name}`,
              "expected i64/u64 decimal data",
            );
          }
          const number = BigInt(integer.data);
          const min = integer.dtype === "i64" ? -(1n << 63n) : 0n;
          const max =
            integer.dtype === "i64" ? (1n << 63n) - 1n : (1n << 64n) - 1n;
          if (number < min || number > max) {
            throw new WireError(
              `meta.${name}`,
              `${integer.dtype} value is out of range`,
            );
          }
          frame.setMeta(name, number);
          continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new WireError(
            `meta.${name}`,
            `must be a finite number, received ${describe(value)}`,
          );
        }
        frame.setMeta(name, value);
      }
    }

    // Schema judgment lives in molrs. Prefer the bound method when the
    // installed wasm exposes it; never re-check endpoint ranges here.
    const validate = (frame as { validate?: () => void }).validate?.bind(frame);
    if (validate) {
      try {
        validate();
      } catch (error) {
        throw new WireError("", messageOf(error));
      }
    }
  } catch (error) {
    frame.free?.();
    throw error;
  }

  return frame;
}

function toShape(path: string, value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.some((n) => !Number.isSafeInteger(n) || n < 0)
  ) {
    throw new WireError(
      path,
      `'shape' must be an array of non-negative integers, received ${describe(value)}`,
    );
  }
  return value as number[];
}

/**
 * Build a molrs `Box` from a wire payload.
 *
 * `h` is taken row-major exactly as sent (see {@link WireBox}); no transpose
 * is applied and no orientation is inferred.
 */
export function decodeBox(
  payload: unknown,
  buffers: readonly DataView[] = [],
): Box {
  const wire = asRecord(payload, "box", "box payload");
  const h = resolveCarrier("box.h", "f64", wire.h, buffers) as Float64Array;
  const origin = resolveCarrier(
    "box.origin",
    "f64",
    wire.origin,
    buffers,
  ) as Float64Array;

  if (h.length !== 9) {
    throw new WireError(
      "box.h",
      `must hold 9 values (3×3 row-major), received ${h.length}`,
    );
  }
  if (origin.length !== 3) {
    throw new WireError(
      "box.origin",
      `must hold 3 values, received ${origin.length}`,
    );
  }
  const pbc = wire.pbc;
  if (
    !Array.isArray(pbc) ||
    pbc.length !== 3 ||
    pbc.some((f) => typeof f !== "boolean")
  ) {
    throw new WireError(
      "box.pbc",
      `must be three booleans, received ${describe(pbc)}`,
    );
  }

  return new Box(Cell.matrix(h), origin, pbc as [boolean, boolean, boolean]);
}

// ---------------------------------------------------------------------------
//  Encode — molrs → wire
// ---------------------------------------------------------------------------

/**
 * Serialize a molrs `Frame` for the wire.
 *
 * Every block and every column is emitted — there is no field whitelist, so a
 * frame carrying `charge`, `mol_id`, forces, or a volumetric `grid` block
 * survives the round trip. Numeric columns become {@link BufferRef}s into the
 * returned `buffers`; string columns go inline.
 */
export function encodeFrame(frame: Frame): EncodedFrame {
  const buffers: ArrayBuffer[] = [];
  const blocks: Record<string, WireBlock> = {};

  const push = (data: ArrayBufferView): BufferRef => {
    const bytes = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    buffers.push(bytes);
    return { [BUFFER_REF_MARKER]: true, index: buffers.length - 1 };
  };

  for (const blockName of frame.keys()) {
    const block = frame.get(blockName);

    const columns: Record<string, WireColumn> = {};
    for (const rawName of block.keys()) {
      const name = String(rawName);
      const path = `${blockName}.${name}`;
      const dtype = block.dtype(name);
      if (
        block.validity(name) !== undefined ||
        block.precision(name) !== undefined ||
        block.target(name) !== undefined
      ) {
        throw new WireError(
          path,
          "nullable columns and precision/target declarations cannot be reconstructed by the wire",
        );
      }
      if (
        dtype !== "string" &&
        dtype !== "bool" &&
        !Object.hasOwn(CARRIERS, dtype)
      ) {
        throw new WireError(
          path,
          `column has dtype "${dtype}", which the wire cannot carry`,
        );
      }
      const data = block.copy(name);
      if (dtype === "bool" && (data as boolean[]).length === 0) {
        throw new WireError(
          path,
          "native setter cannot reconstruct an empty bool column",
        );
      }
      columns[name] = {
        dtype: dtype as WireDType,
        data: ArrayBuffer.isView(data)
          ? push(data)
          : ([...(data as boolean[] | string[])] as boolean[] | string[]),
        shape: block.shape(name),
      };
    }

    const wireBlock: WireBlock = { columns };
    // A flat table has no structural shape — its row count is what the
    // columns already carry; only a grid sends one.
    const shape = block.structuralShape;
    if (shape !== undefined) wireBlock.shape = shape;
    blocks[blockName] = wireBlock;
  }

  const wire: WireFrame = { blocks };

  const box = frame.box;
  if (box) {
    wire.box = {
      // Box.h() is already the row-major wire layout (see WireBox).
      h: push(box.h().toCopy()),
      origin: push(box.origin().toCopy()),
      pbc: box.pbc(),
    };
  }

  const metaNames = frame.metaKeys();
  if (metaNames.length > 0) {
    const meta: NonNullable<WireFrame["meta"]> = {};
    for (const name of metaNames) {
      // JSON numbers cannot carry native i64/u64 exactly.
      const value = frame.getMeta(name);
      if (typeof value === "bigint") {
        meta[name] = {
          dtype: value > (1n << 63n) - 1n ? "u64" : "i64",
          data: value.toString(),
        };
      } else if (typeof value === "number" && Number.isFinite(value)) {
        meta[name] = value;
      }
    }
    if (Object.keys(meta).length > 0) wire.meta = meta;
  }

  return { frame: wire, buffers };
}
