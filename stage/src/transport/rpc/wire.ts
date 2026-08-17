/**
 * Frame wire format — the one serialization for molecular data crossing the
 * JSON-RPC seam, in **both** directions.
 *
 * ## Nothing here is invented
 *
 * - **Column and block names** are molrs's. `molrs::store::keys` is the single
 *   source of truth (`x`/`y`/`z`, `element`, `symbol`, `type`, `charge`,
 *   `atomi`/`atomj`/`atomk`/`atoml`, `order`, …) and molpy re-exports the same
 *   registry through `molrs.fields`. This module therefore **never** inspects,
 *   renames, aliases, or requires a column name. Format-native spellings
 *   (`species`, `i`/`j`, `q`, `mol`) are translated by
 *   `molrs.fields.FieldFormatter.canonicalize()` at the I/O boundary, which is
 *   the layer that owns that mapping — not this one.
 * - **dtype strings** are molrs's JS spelling: exactly what `Block.dtype()`
 *   returns and what the `setCol*` setters are named after.
 *
 *   | wire dtype | JS carrier      | molrs setter  | molrs getter  |
 *   | ---------- | --------------- | ------------- | ------------- |
 *   | `"f64"`    | `Float64Array`  | `setColF`     | `copyColF`    |
 *   | `"i32"`    | `Int32Array`    | `setColI32`   | `copyColI32`  |
 *   | `"u32"`    | `Uint32Array`   | `setColU32`   | `copyColU32`  |
 *   | `"string"` | `string[]`      | `setColStr`   | `copyColStr`  |
 *
 *   Those four are the complete set molrs-wasm can write. A producer holding a
 *   bool or u8 column converts it before sending and says so in the dtype tag;
 *   the decision is the producer's, never this decoder's.
 *
 * ## The contract
 *
 * Every column states its own dtype. This module performs **no inference** —
 * it never looks at a value to decide what it is. The only local checks are the
 * ones that make a transport violation diagnosable: the dtype tag must be one
 * of the four, and the carrier must match the tag. Frame *schema* judgment
 * (endpoint ranges, required relation columns, canonical dtypes) is
 * **molrs's** job — after the frame is built we call `frame.validate()`, which
 * runs `Validator::canonical`. Do not re-check those rules in TypeScript.
 *
 * @module
 */

import { type Block, Box, Frame } from "@molcrafts/molvis-core/molrs";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

/** The dtype tags molrs-wasm can round-trip. */
export type WireDType = "f64" | "i32" | "u32" | "string";

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
export type WireColumn =
  | { dtype: "f64"; data: Float64Array | BufferRef }
  | { dtype: "i32"; data: Int32Array | BufferRef }
  | { dtype: "u32"; data: Uint32Array | BufferRef }
  | { dtype: "string"; data: string[] };

/**
 * One block: named columns, plus the block shape when it is not a flat table.
 *
 * `shape` maps to molrs `Block.setShape()` / `Block.shape()` — `[1000]` for a
 * 1000-atom block, `[32, 32, 32]` for a volumetric grid.
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
 * `new Box(h, …)` consumes.
 *
 * Note that molrs `Box.hMatrix()` returns the **transpose** of this (the same
 * matrix flattened column-major); {@link encodeFrame} transposes on the way out
 * so both directions of the wire agree on one convention. There is no
 * orientation sniffing anywhere — a producer that sends the transpose gets a
 * silently transposed cell, which is why the convention is spelled out here
 * rather than left to a 3×3-shaped guess.
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
  /** Per-frame scalars — molrs `Frame.setMetaScalar` / `getMetaScalar`. */
  meta?: Record<string, number>;
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
  dtype: Exclude<WireDType, "string">,
  data: unknown,
  buffers: readonly DataView[],
): Float64Array | Int32Array | Uint32Array {
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

  switch (dtype) {
    case "f64":
      if (data instanceof Float64Array) return data;
      break;
    case "i32":
      if (data instanceof Int32Array) return data;
      break;
    case "u32":
      if (data instanceof Uint32Array) return data;
      break;
  }
  throw new WireError(
    path,
    `dtype "${dtype}" requires ${CARRIER_NAME[dtype]} or a buffer reference, received ${describe(data)}`,
  );
}

const CARRIER_NAME = {
  f64: "a Float64Array",
  i32: "an Int32Array",
  u32: "a Uint32Array",
} as const;

const BYTES_PER_ELEMENT = { f64: 8, i32: 4, u32: 4 } as const;

/** Reinterpret transport bytes as the typed array the dtype tag names. */
function viewAs(
  path: string,
  dtype: Exclude<WireDType, "string">,
  view: DataView,
): Float64Array | Int32Array | Uint32Array {
  const itemSize = BYTES_PER_ELEMENT[dtype];
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
  switch (dtype) {
    case "f64":
      return new Float64Array(aligned.buffer, aligned.offset, count);
    case "i32":
      return new Int32Array(aligned.buffer, aligned.offset, count);
    case "u32":
      return new Uint32Array(aligned.buffer, aligned.offset, count);
  }
}

/** Swap between the row-major wire cell and molrs's column-major `hMatrix()`. */
function transpose3x3(flat: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[3 * row + col] = flat[3 * col + row];
    }
  }
  return out;
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
 * Exhaustive over {@link WireDType}: adding a dtype without adding its setter
 * is a compile error, not a runtime surprise.
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
  switch (column.dtype) {
    case "f64":
      block.setColF(
        name,
        resolveCarrier(path, "f64", column.data, buffers) as Float64Array,
      );
      return;
    case "i32":
      block.setColI32(
        name,
        resolveCarrier(path, "i32", column.data, buffers) as Int32Array,
      );
      return;
    case "u32":
      block.setColU32(
        name,
        resolveCarrier(path, "u32", column.data, buffers) as Uint32Array,
      );
      return;
    case "string": {
      const data = column.data;
      if (
        !Array.isArray(data) ||
        data.some((item) => typeof item !== "string")
      ) {
        throw new WireError(
          path,
          `dtype "string" requires a string[], received ${describe(data)}`,
        );
      }
      block.setColStr(name, data);
      return;
    }
    default: {
      const unknown: never = column;
      throw new WireError(
        path,
        `unknown dtype ${JSON.stringify((unknown as { dtype?: unknown }).dtype)}`,
      );
    }
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
        block.setShape(toShape(blockName, blockRecord.shape));
      }
    }

    if (wire.box != null) {
      frame.box = decodeBox(wire.box, buffers);
    }

    if (wire.meta !== undefined) {
      const meta = asRecord(wire.meta, "", "frame 'meta'");
      for (const [name, value] of Object.entries(meta)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new WireError(
            `meta.${name}`,
            `must be a finite number, received ${describe(value)}`,
          );
        }
        frame.setMetaScalar(name, value);
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

function toShape(path: string, value: unknown): Uint32Array {
  if (
    !Array.isArray(value) ||
    value.some((n) => !Number.isInteger(n) || n < 0)
  ) {
    throw new WireError(
      path,
      `block 'shape' must be an array of non-negative integers, received ${describe(value)}`,
    );
  }
  return Uint32Array.from(value as number[]);
}

/**
 * Build a molrs `Box` from a wire payload.
 *
 * `h` is taken column-major exactly as sent (see {@link WireBox}); no transpose
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
      `must hold 9 values (3×3 column-major), received ${h.length}`,
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

  return new Box(h, origin, pbc[0], pbc[1], pbc[2]);
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

  for (const blockName of frame.blockNames()) {
    const block = frame.getBlock(blockName);
    if (!block) continue;

    const columns: Record<string, WireColumn> = {};
    for (const rawName of block.keys()) {
      const name = String(rawName);
      const dtype = block.dtype(name);
      switch (dtype) {
        // molrs reports the compile-time float scalar as "f32" or "f64"; both
        // come back through copyColF as a Float64Array.
        case "f32":
        case "f64":
          columns[name] = { dtype: "f64", data: push(block.copyColF(name)) };
          break;
        case "i32":
          columns[name] = { dtype: "i32", data: push(block.copyColI32(name)) };
          break;
        case "u32":
          columns[name] = { dtype: "u32", data: push(block.copyColU32(name)) };
          break;
        case "string":
          columns[name] = {
            dtype: "string",
            data: block.copyColStr(name).map(String),
          };
          break;
        default:
          // "bool" / "u8" have no molrs-wasm getter, so they cannot be read
          // back here. Dropping silently would be the whitelist bug again.
          throw new WireError(
            `${blockName}.${name}`,
            `column has dtype "${String(dtype)}", which molrs-wasm cannot read back`,
          );
      }
    }

    const wireBlock: WireBlock = { columns };
    const shape = Array.from(block.shape(), Number);
    // A flat table's shape is just its row count, which the columns already
    // carry; only send a shape that says something more (e.g. a grid).
    if (shape.length > 1) wireBlock.shape = shape;
    blocks[blockName] = wireBlock;
  }

  const wire: WireFrame = { blocks };

  const box = frame.box;
  if (box) {
    wire.box = {
      // hMatrix() is column-major; the wire is row-major (see WireBox).
      h: push(transpose3x3(box.hMatrix().toCopy())),
      origin: push(box.origin().toCopy()),
      pbc: Array.from(box.pbc(), (flag) => flag !== 0) as [
        boolean,
        boolean,
        boolean,
      ],
    };
  }

  const metaNames = frame.metaNames();
  if (metaNames.length > 0) {
    const meta: Record<string, number> = {};
    for (const name of metaNames) {
      // getMetaScalar is the only reader molrs-wasm exposes; string-valued meta
      // is not representable and is left out rather than stringified.
      const value = frame.getMetaScalar(name);
      if (typeof value === "number" && Number.isFinite(value))
        meta[name] = value;
    }
    if (Object.keys(meta).length > 0) wire.meta = meta;
  }

  return { frame: wire, buffers };
}
