import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { HideSelectionModifier } from "../../src/modifiers/HideSelectionModifier";
import { SelectModifier } from "../../src/modifiers/SelectModifier";
import { MemoryDataSource } from "../../src/pipeline/data_source";
import { BaseModifier, ModifierCapability } from "../../src/pipeline/modifier";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import type { PipelineContext } from "../../src/pipeline/types";

function frame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(3));
  atoms.set("y", new Float64Array(3));
  atoms.set("z", new Float64Array(3));
  atoms.set("element", ["C", "O", "N"]);
  frame.set("atoms", atoms);
  return frame;
}

class SpyModifier extends BaseModifier {
  seen: number[] = [];

  constructor() {
    super("spy", "Spy", new Set([ModifierCapability.ConsumesSelection]));
  }

  apply(input: Frame, context: PipelineContext): Frame {
    this.seen = context.currentSelection.getIndices();
    return input;
  }
}

const mockApp = {} as MolvisApp;

describe("pipeline selection scopes", () => {
  it("selectionScopeId controls consumed selection", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.addSource(new MemoryDataSource(frame()));
    const select = new SelectModifier("select", [1]);
    pipeline.addModifier(select);
    const spy = new SpyModifier();
    pipeline.addModifier(spy);

    expect(pipeline.setSelectionScope(spy.id, select.id)).toBe(true);
    await pipeline.compute(0, mockApp);

    expect(spy.seen).toEqual([1]);
  });

  it("sourceOwnerId only controls tree ownership", async () => {
    const pipeline = new ModifierPipeline();
    const source = new MemoryDataSource(frame());
    pipeline.addSource(source);
    const spy = new SpyModifier();
    pipeline.addModifier(spy);

    expect(pipeline.setSourceOwner(spy.id, source.id)).toBe(true);
    await pipeline.compute(0, mockApp);

    expect(pipeline.getChildren(source.id).map((m) => m.id)).toEqual([spy.id]);
    expect(spy.seen).toEqual([0, 1, 2]);
  });

  it("runs a consuming transform after its scoped selection producer", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.addSource(new MemoryDataSource(frame()));
    const select = new SelectModifier("select", [1]);
    pipeline.addModifier(select);
    const hide = new HideSelectionModifier();
    pipeline.addModifier(hide);

    expect(pipeline.setSelectionScope(hide.id, select.id)).toBe(true);
    const out = await pipeline.compute(0, mockApp);

    // Select [1] then Hide must leave atoms 0 and 2, not hide everything.
    expect(out.get("atoms").nRows).toBe(2);
    expect([...(out.get("atoms").copy("element") as string[])]).toEqual([
      "C",
      "N",
    ]);
  });
});
