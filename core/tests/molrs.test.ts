import { describe, expect, it } from "@rstest/core";
import { toDomainUint } from "../src/domain_uint";
import * as molrs from "../src/molrs";
import {
  Block,
  Conformer,
  DcdStream,
  Frame,
  Lbfgs,
  NeighborList,
  PotentialCompiler,
  SmilesIr,
  UffTypifier,
  writeEncodedFrame,
} from "../src/molrs";

describe("molrs gateway", () => {
  it("constructs Frame and Block", () => {
    const frame = new Frame();
    const block = new Block();
    block.set("element", ["C", "O"]);
    frame.set("atoms", block);
    expect(frame.get("atoms")?.nRows).toBe(2);
    frame.free();
  });

  it("SmilesIr.parse + Conformer.generate water path", () => {
    const ir = SmilesIr.parse("O");
    const f2 = ir.toFrame();
    const conformer = new Conformer("fast", null, 1);
    const f3 = conformer.generate(f2);
    conformer.free();
    const atoms = f3.get("atoms");
    expect(atoms).toBeDefined();
    expect((atoms?.nRows ?? 0) > 0).toBe(true);
    f2.free();
    f3.free();
    ir.free();
  });

  it("UffTypifier + Lbfgs.minimize composition on ethanol", async () => {
    const ir = SmilesIr.parse("CCO");
    const f2 = ir.toFrame();
    const conformer = new Conformer("fast", null, 1);
    const f3 = conformer.generate(f2);
    conformer.free();
    f2.free();
    ir.free();

    const typifier = new UffTypifier();
    const typed = typifier.typify(f3);
    const ff = typifier.forcefield();
    const compiler = new PotentialCompiler(ff);
    const pots = compiler.compile(typed);
    // Cell-list pairs at the UFF nonbonded shell (~12.5 Å).
    const cell = new NeighborList(12.5);
    cell.build(typed);
    const nlist = cell.neighbors();
    const opt = new Lbfgs(pots, nlist, 0.1);
    const report = opt.minimize(typed, 50);

    expect(report.nSteps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.finalEnergy)).toBe(true);
    expect(typeof report.converged).toBe("boolean");

    report.free();
    opt.free();
    nlist.free();
    pots.free();
    compiler.free();
    ff.free();
    typed.free();
    typifier.free();
    cell.free();
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
  entries: ReturnType<DcdStream["feedIndexChunk"]>;
} {
  const stream = new DcdStream();
  stream.hintTotalBytes?.(bytes.byteLength);
  writeInto(stream, bytes);
  const entries = stream.feedIndexChunk(0, bytes.byteLength);
  stream.finishIndex();
  return { stream, entries };
}

function buildMultiDcd(seeds: number[], patchNset = true): Uint8Array {
  const parts = seeds.map((seed) => {
    const bytes = writeEncodedFrame(makeCoordFrame(4, seed), "dcd");
    const { entries } = indexFrames(bytes);
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

/** Column `x` of the `atoms` block of a Frame the stream decoded. */
function xCol(frame: Frame): Float64Array | undefined {
  const x = frame.get("atoms")?.copy("x") as Float64Array | undefined;
  frame.free();
  return x;
}

describe("DcdStream index", () => {
  it("counts every frame even when the DCD NSET header says 1", () => {
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

  it("reads every frame of a multi-frame DCD", () => {
    const bytes = buildMultiDcd([0, 1, 2]);
    const { stream, entries } = indexFrames(bytes);
    expect(entries.length).toBe(3);
    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i];
      const frame = stream.parseRangeInInput(pos.byteOffset, pos.byteLen);
      const x = frame.get("atoms")?.view("x");
      expect(x?.[0]).toBeCloseTo(i, 5);
      frame.free();
    }
    stream.free();
  });
});

describe("DcdStream", () => {
  it("decodes every frame range without setDecoderState", () => {
    const seeds = [0, 1, 2];
    const bytes = buildMultiDcd(seeds);
    const { entries } = indexFrames(bytes);
    expect(entries.length).toBe(seeds.length);

    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i];
      const range = bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen);
      const parseStream = new DcdStream();
      writeInto(parseStream, range);
      const frame = parseStream.parseRangeInInput(0, range.byteLength);
      expect(xCol(frame)?.[0]).toBeCloseTo(seeds[i], 5);
    }
  });

  it("reuses one parseStream across frames", () => {
    const seeds = [0, 1, 2];
    const bytes = buildMultiDcd(seeds);
    const { stream: indexStream, entries } = indexFrames(bytes);
    const parseStream = new DcdStream();
    const ctx = indexStream.decoderState();
    if (ctx && ctx.length > 0) parseStream.setDecoderState(ctx);

    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i];
      const range = bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen);
      writeInto(parseStream, range);
      const frame = parseStream.parseRangeInInput(0, range.byteLength);
      expect(xCol(frame)?.[0]).toBeCloseTo(seeds[i], 5);
    }
  });
});
