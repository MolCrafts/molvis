import { describe, expect, it } from "@rstest/core";
import { toDomainUint } from "../src/domain_uint";
import * as molrs from "../src/molrs";
import {
  Block,
  Conformer,
  DcdStream,
  Frame,
  SmilesIr,
  writeDcdBytes,
} from "../src/molrs";

/** Embed `smiles` in 3D with a fixed seed; the caller frees the frame. */
function embed(smiles: string): Frame {
  const ir = SmilesIr.parse(smiles);
  const f2 = ir.toFrame();
  const conformer = new Conformer("fast", true, 1);
  try {
    return conformer.generate(f2);
  } finally {
    conformer.free();
    f2.free();
    ir.free();
  }
}

describe("molrs gateway", () => {
  it("constructs Frame and Block", () => {
    const frame = new Frame();
    const block = new Block();
    block.set("element", ["C", "O"]);
    frame.set("atoms", block);
    expect(frame.get("atoms").nRows).toBe(2);
    frame.free();
  });

  it("SmilesIr + Conformer water path", () => {
    const f3 = embed("O");
    expect(f3.get("atoms").nRows).toBeGreaterThan(0);
    f3.free();
  });

  it("UffTypifier + PotentialCompiler + Lbfgs.minimize composition on ethanol", async () => {
    const { Lbfgs, NeighborList, PotentialCompiler, UffTypifier } =
      await import("../src/molrs");
    const f3 = embed("CCO");

    const typifier = new UffTypifier();
    const typed = typifier.typify(f3);
    const forcefield = typifier.forcefield();
    const compiler = new PotentialCompiler(forcefield);
    const pots = compiler.compile(typed);
    // Always pass a spatial NL (UFF nonbonded shell ~12.5 Å).
    const list = new NeighborList(12.5);
    list.build(typed);
    const pairs = list.neighbors({ distSq: true, disp: false });
    const opt = new Lbfgs(pots, pairs, 0.1);
    const report = opt.minimize(typed, 50);

    expect(report.nSteps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.finalEnergy)).toBe(true);
    expect(typeof report.converged).toBe("boolean");

    report.free();
    opt.free();
    pairs.free();
    list.free();
    pots.free();
    compiler.free();
    forcefield.free();
    typed.free();
    typifier.free();
    f3.free();
  });
});

describe("mrec gateway", () => {
  it("re-exports every MrecReader door", async () => {
    const { MrecReader, openMrecStore } = await import("../src/molrs");
    expect(typeof MrecReader).toBe("function");
    expect(typeof MrecReader.fromZip).toBe("function");
    expect(typeof MrecReader.fromStorage).toBe("function");
    expect(typeof MrecReader.prototype.readColumns).toBe("function");
    expect(typeof MrecReader.prototype.blockUpdateAt).toBe("function");
    expect(typeof openMrecStore).toBe("function");
  });

  it("openMrecStore names a host missing a required method", async () => {
    const { openMrecStore } = await import("../src/molrs");
    const partial = {
      get: () => null,
      size: () => null,
    } as unknown as import("../src/molrs").MrecStoreHost;
    expect(() => openMrecStore(partial)).toThrow(/lacks list/);
  });

  it("openMrecStore reads keys through the host, not a copy", async () => {
    const { openMrecStore } = await import("../src/molrs");
    const seen: string[] = [];
    const host = {
      get: (key: string) => {
        seen.push(`get:${key}`);
        return null;
      },
      size: () => null,
      list: (prefix: string) => {
        seen.push(`list:${prefix}`);
        return [];
      },
    };
    // An empty store is not a sequence; the open must fail through the
    // host's own answers rather than by never consulting it.
    expect(() => openMrecStore(host)).toThrow();
    expect(seen.length).toBeGreaterThan(0);
  });
});

/** Byte offset of NSET in a DCD header. MolRS has no multi-frame writer. */
const DCD_NSET_OFFSET = 8;

function makeCoordFrame(n: number, seed: number): Frame {
  const block = new Block();
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = seed + i * 0.1;
    y[i] = seed + i * 0.2;
    z[i] = seed + i * 0.3;
  }
  const id = new Uint32Array(n);
  for (let i = 0; i < n; i++) id[i] = i + 1;
  block.set("id", toDomainUint(id));
  block.set("x", x);
  block.set("y", y);
  block.set("z", z);
  const frame = new Frame();
  frame.set("atoms", block);
  return frame;
}

function writeInto(stream: DcdStream, bytes: Uint8Array): void {
  const ptr = stream.allocInputBuffer(bytes.byteLength);
  new Uint8Array(molrs.wasmMemory().buffer, ptr, bytes.byteLength).set(bytes);
}

function indexFrames(bytes: Uint8Array): {
  stream: DcdStream;
  entries: Array<{ byteOffset: number; byteLen: number }>;
} {
  const stream = new DcdStream();
  stream.hintTotalBytes(bytes.byteLength);
  writeInto(stream, bytes);
  const entries = [
    ...stream.feedIndexChunk(0, bytes.byteLength),
    ...stream.finishIndex(),
  ].map((entry) => {
    const pos = { byteOffset: entry.byteOffset, byteLen: entry.byteLen };
    entry.free();
    return pos;
  });
  return { stream, entries };
}

function buildMultiDcd(seeds: number[], patchNset = true): Uint8Array {
  const parts = seeds.map((seed) => {
    const bytes = writeDcdBytes(makeCoordFrame(4, seed));
    const { stream, entries } = indexFrames(bytes);
    stream.free();
    const pos = entries[0];
    return {
      header: bytes.slice(0, pos.byteOffset),
      frameBlock: bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen),
    };
  });
  const header = parts[0].header.slice();
  if (patchNset) {
    new DataView(header.buffer, header.byteOffset, header.byteLength).setInt32(
      DCD_NSET_OFFSET,
      seeds.length,
      true,
    );
  }
  const total =
    header.length + parts.reduce((sum, p) => sum + p.frameBlock.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const part of parts) {
    out.set(part.frameBlock, offset);
    offset += part.frameBlock.length;
  }
  return out;
}

/** The decoded frame's first `x`; frees the frame. */
function firstX(frame: Frame): number {
  try {
    return (frame.get("atoms").view("x") as Float64Array)[0];
  } finally {
    frame.free();
  }
}

describe("DcdStream", () => {
  it("indexes every frame even when the DCD NSET header says 1", () => {
    const bytes = buildMultiDcd([0, 1, 2], false);
    const nset = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getInt32(DCD_NSET_OFFSET, true);
    expect(nset).toBe(1);

    const { stream, entries } = indexFrames(bytes);
    expect(entries.length).toBe(3);
    stream.free();
  });

  it("decodes every frame range without setDecoderState", () => {
    const seeds = [0, 1, 2];
    const bytes = buildMultiDcd(seeds);
    const { stream, entries } = indexFrames(bytes);
    stream.free();
    expect(entries.length).toBe(seeds.length);

    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i];
      const range = bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen);
      const parseStream = new DcdStream();
      writeInto(parseStream, range);
      expect(
        firstX(parseStream.parseRangeInInput(0, range.byteLength)),
      ).toBeCloseTo(seeds[i], 5);
      parseStream.free();
    }
  });

  it("reuses one parseStream across frames", () => {
    const seeds = [0, 1, 2];
    const bytes = buildMultiDcd(seeds);
    const { stream: indexStream, entries } = indexFrames(bytes);
    const parseStream = new DcdStream();
    const decoderState = indexStream.decoderState();
    if (decoderState && decoderState.length > 0) {
      parseStream.setDecoderState(decoderState);
    }
    indexStream.free();

    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i];
      const range = bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen);
      writeInto(parseStream, range);
      expect(
        firstX(parseStream.parseRangeInInput(0, range.byteLength)),
      ).toBeCloseTo(seeds[i], 5);
    }
    parseStream.free();
  });
});
