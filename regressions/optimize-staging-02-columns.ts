/**
 * Contract lock for atom-column transport: a source block's columns survive a
 * commit / optimize round trip value-for-value, and a destination row with no
 * source row reads a neutral value instead of a neighbour's.
 *
 * Goldens are literals typed in here, not captured from any tool: the charges
 * are the textbook TIP3P water partial charges (O -0.834 e, H +0.417 e, which
 * sum to zero), `mol_id` 1 is the single molecule they belong to and `res_name`
 * "HOH" is its PDB residue name. Nothing computes them, no oracle is consulted
 * and no file is read — they are here to be carried unchanged, which is the
 * whole contract.
 *
 * The scenario is the one the optimizer produces: three atoms in, four atoms
 * out because a hydrogen was added to cap a valence. The mapping is the
 * identity, so row 3 asks for source row 3 — one past the source's last row.
 * That is exactly how "this atom has no source row" reaches the carrier at both
 * call sites (a canvas-drawn atom's scene id is past the source frame's rows
 * too), and it must yield 0 / 0 / "" rather than a repeat of row 2.
 *
 * Values move between JS typed arrays with no arithmetic, so every assert is an
 * exact comparison; a tolerance here would only mask a dtype narrowing.
 *
 * Run with the repo TS runner: `node regressions/optimize-staging-02-columns.ts`
 * after `npm run build:stage`.
 *
 * `atom_columns` is a stage-internal seam and by invariant is on no public
 * barrel, so it is pinned at its build-output deep path — same convention as
 * `regressions/optimize-staging-01-positions.ts`. Its runtime closure is the
 * dtype string table and nothing else: no molrs import, no WebAssembly (WASM)
 * module, no Babylon engine, no subprocess. Both collaborators below are plain
 * objects, so the `Block` borrow rule cannot even be exercised here — which is
 * the point of the protocol being structural.
 */
import { AtomColumnCarrier } from "../stage/dist/atom_columns.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * The two protocol surfaces, taken from the class itself — that keeps this
 * script's import list at exactly one module.
 */
type ColumnSource = ConstructorParameters<typeof AtomColumnCarrier>[0];
type ColumnSink = Parameters<AtomColumnCarrier["copyInto"]>[0];

/** Source rows: one water. Destination rows: the same water plus one new H. */
const SOURCE_ROWS = 3;
const DEST_ROWS = 4;

const CHARGE = [-0.834, 0.417, 0.417];
const MOL_ID = [1, 1, 1];
const RES_NAME = ["HOH", "HOH", "HOH"];

/**
 * A read-only column store holding the literals above, one column per dtype the
 * carrier dispatches on. The `copyCol*` readers throw on a dtype mismatch, the
 * way molrs's `Block` does, so a carrier that read a column before checking its
 * dtype would fail here instead of silently producing garbage.
 */
class LiteralColumns implements ColumnSource {
  keys(): string[] {
    return ["charge", "mol_id", "res_name"];
  }

  nrows(): number {
    return SOURCE_ROWS;
  }

  dtype(key: string): string | undefined {
    if (key === "charge") return "f64";
    if (key === "mol_id") return "u32";
    if (key === "res_name") return "string";
    return undefined;
  }

  copyColF(key: string): Float64Array | undefined {
    if (key !== "charge") throw new Error(`${key} is not a float column`);
    return Float64Array.from(CHARGE);
  }

  copyColU32(key: string): Uint32Array | undefined {
    if (key !== "mol_id") throw new Error(`${key} is not a u32 column`);
    return Uint32Array.from(MOL_ID);
  }

  copyColStr(key: string): string[] | undefined {
    if (key !== "res_name") throw new Error(`${key} is not a string column`);
    return [...RES_NAME];
  }

  copyColI32(key: string): Int32Array | undefined {
    throw new Error(`${key} is not an i32 column`);
  }
}

/** Destination store: keeps whatever the carrier writes, per dtype. */
class CollectedColumns implements ColumnSink {
  floats: Map<string, Float64Array>;
  strings: Map<string, string[]>;
  u32s: Map<string, Uint32Array>;
  i32s: Map<string, Int32Array>;

  constructor() {
    this.floats = new Map<string, Float64Array>();
    this.strings = new Map<string, string[]>();
    this.u32s = new Map<string, Uint32Array>();
    this.i32s = new Map<string, Int32Array>();
  }

  setColF(key: string, value: Float64Array): void {
    this.floats.set(key, value);
  }

  setColStr(key: string, value: string[]): void {
    this.strings.set(key, value);
  }

  setColU32(key: string, value: Uint32Array): void {
    this.u32s.set(key, value);
  }

  setColI32(key: string, value: Int32Array): void {
    this.i32s.set(key, value);
  }

  floatCol(key: string): Float64Array {
    const col = this.floats.get(key);
    if (!col) throw new Error(`float column ${key} was never written`);
    return col;
  }

  u32Col(key: string): Uint32Array {
    const col = this.u32s.get(key);
    if (!col) throw new Error(`u32 column ${key} was never written`);
    return col;
  }

  strCol(key: string): string[] {
    const col = this.strings.get(key);
    if (!col) throw new Error(`string column ${key} was never written`);
    return col;
  }
}

// --- copyInto: three source rows onto four destination rows, identity map ----

const sink = new CollectedColumns();
new AtomColumnCarrier(new LiteralColumns()).copyInto(
  sink,
  DEST_ROWS,
  (row: number) => row,
);

// --- The mapped rows carry their source values, column by column -------------

const charge = sink.floatCol("charge");
assert(charge.length === DEST_ROWS, `charge rows ${charge.length}`);
assert(charge[0] === -0.834, `charge row 0 ${charge[0]}`);
assert(charge[1] === 0.417, `charge row 1 ${charge[1]}`);
assert(charge[2] === 0.417, `charge row 2 ${charge[2]}`);

const molId = sink.u32Col("mol_id");
assert(molId.length === DEST_ROWS, `mol_id rows ${molId.length}`);
assert(molId[0] === 1, `mol_id row 0 ${molId[0]}`);
assert(molId[1] === 1, `mol_id row 1 ${molId[1]}`);
assert(molId[2] === 1, `mol_id row 2 ${molId[2]}`);

const resName = sink.strCol("res_name");
assert(resName.length === DEST_ROWS, `res_name rows ${resName.length}`);
assert(resName[0] === "HOH", `res_name row 0 ${resName[0]}`);
assert(resName[1] === "HOH", `res_name row 1 ${resName[1]}`);
assert(resName[2] === "HOH", `res_name row 2 ${resName[2]}`);

// --- The added atom has no source row: neutral, never row 2 repeated ---------

assert(charge[3] === 0, `added atom charge ${charge[3]}`);
assert(molId[3] === 0, `added atom mol_id ${molId[3]}`);
assert(resName[3] === "", `added atom res_name "${resName[3]}"`);

console.log("optimize-staging-02-columns ok");
