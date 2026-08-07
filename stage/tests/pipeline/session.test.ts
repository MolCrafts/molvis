import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { WrapPBCModifier } from "../../src/modifiers/WrapPBCModifier";
import { MemoryDataSource } from "../../src/pipeline/data_source";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { Session } from "../../src/pipeline/session";
import "../setup_wasm";

describe("Session", () => {
  const session = (address = "ws://localhost:1", onClose = () => {}) =>
    new Session("session", address, onClose);

  it("is neither a source nor a modifier", () => {
    const pipeline = new ModifierPipeline();
    pipeline.setSession(session());
    pipeline.addSource(new MemoryDataSource(new Frame()));
    pipeline.addModifier(new WrapPBCModifier("wrap"));

    // It occupies a row, and only a row: composition and the apply chain
    // must not see it.
    expect(pipeline.getEntries()).toHaveLength(3);
    expect(pipeline.sources()).toHaveLength(1);
    expect(pipeline.modifiers()).toHaveLength(1);
    expect(pipeline.session()).not.toBeNull();
  });

  it("caps at one — installing a second replaces the first", () => {
    const pipeline = new ModifierPipeline();
    let closed = 0;
    pipeline.setSession(session("ws://first", () => closed++));
    pipeline.setSession(session("ws://second"));

    expect(pipeline.getEntries()).toHaveLength(1);
    expect(pipeline.session()?.address).toBe("ws://second");
    expect(closed).toBe(1);
  });

  it("removing it disconnects", () => {
    const pipeline = new ModifierPipeline();
    let closed = 0;
    const s = session("ws://x", () => closed++);
    pipeline.setSession(s);

    pipeline.removeEntry(s.id);

    expect(closed).toBe(1);
    expect(pipeline.session()).toBeNull();
  });

  it("clear() disconnects it too — it is an entry like any other", () => {
    const pipeline = new ModifierPipeline();
    let closed = 0;
    pipeline.setSession(session("ws://x", () => closed++));

    pipeline.clear();

    expect(closed).toBe(1);
    expect(pipeline.session()).toBeNull();
  });
});
