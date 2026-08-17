import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { StreamDataSource } from "../../src/pipeline/stream_data_source";
import "../setup_wasm";

describe("StreamDataSource", () => {
  it("grows at the tail and reports the retained count", () => {
    const src = new StreamDataSource("ws://localhost:1");
    expect(src.frameCount).toBe(0);

    expect(src.push(new Frame())).toBe(0);
    expect(src.push(new Frame())).toBe(1);
    expect(src.frameCount).toBe(2);
    expect(src.evicted).toBe(0);
  });

  it("evicts from the head once maxFrames is exceeded", () => {
    const src = new StreamDataSource("ws://localhost:1", { maxFrames: 2 });
    for (let i = 0; i < 5; i++) src.push(new Frame());

    // The window is bounded, not the run: five arrived, two are kept.
    expect(src.frameCount).toBe(2);
    expect(src.evicted).toBe(3);
  });

  it("keeps everything when maxFrames is unset", () => {
    const src = new StreamDataSource("ws://localhost:1");
    for (let i = 0; i < 5; i++) src.push(new Frame());
    expect(src.frameCount).toBe(5);
    expect(src.evicted).toBe(0);
  });

  it("preload rejects an index outside the retained window", async () => {
    const src = new StreamDataSource("ws://localhost:1", { maxFrames: 1 });
    src.push(new Frame());
    src.push(new Frame());

    await expect(src.preload(1)).rejects.toThrow(/retained window/);
  });

  it("is a source, not a modifier", () => {
    const pipeline = new ModifierPipeline();
    const src = new StreamDataSource("ws://localhost:1");
    pipeline.addSource(src);

    expect(pipeline.sources()).toHaveLength(1);
    expect(pipeline.modifiers()).toHaveLength(0);
    expect(src.kind).toBe("stream");
  });
});

describe("StreamDataSource wire decoding", () => {
  it("round-trips a frame through the molrs codec", async () => {
    const { writeFrameBytes } = await import("@molcrafts/molvis-core/molrs");

    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([1, 4]));

    const src = new StreamDataSource("ws://localhost:1");
    const index = await src.ingest(writeFrameBytes(frame, "msgpack"));

    expect(index).toBe(0);
    const back = await src.getFrame(0);
    const x = back.getBlock("atoms")?.copyColF("x");
    expect(Array.from(x ?? [])).toEqual([1, 4]);
  });
});
