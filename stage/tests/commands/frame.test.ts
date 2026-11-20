import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { afterEach, describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { ExportFrameCommand } from "../../src/commands/frame";
import { AtomSource, BondSource } from "../../src/entity_source";
import type { SceneIndex } from "../../src/scene_index";

/** Unit tests for source-column preservation and stable dense-row identities. */

function mockSceneIndex(atoms: AtomSource, bonds: BondSource): SceneIndex {
  return {
    metaRegistry: { atoms, bonds },
    markAllSaved() {},
  } as unknown as SceneIndex;
}

/** Water, carrying the two column kinds the docstring names: charge + mol_id. */
function chargedSourceFrame(): Frame {
  const frame = new Frame();
  const block = new Block();
  block.set("x", new Float64Array([0, 1, 0]));
  block.set("y", new Float64Array([0, 0, 1]));
  block.set("z", new Float64Array([0, 0, 0]));
  block.set("element", ["O", "H", "H"]);
  block.set("charge", new Float64Array([0.5, -0.25, 0.125]));
  block.set("mol_id", toDomainUint([1, 1, 1]));
  frame.set("atoms", block);
  return frame;
}

/** App stand-in: the command reads `world.sceneIndex`; `frame` is HEAD. */
function mockApp(sceneIndex: SceneIndex, head: Frame): MolvisApp {
  return {
    world: { sceneIndex },
    frame: head,
  } as unknown as MolvisApp;
}

const ownedFrames: Frame[] = [];
afterEach(() => {
  for (const frame of ownedFrames) frame.free();
  ownedFrames.length = 0;
});

function exportedAtoms(): Block {
  const sourceFrame = chargedSourceFrame();
  const atoms = new AtomSource();
  atoms.setFrame(sourceFrame);
  const sceneIndex = mockSceneIndex(atoms, new BondSource());
  const command = new ExportFrameCommand(mockApp(sceneIndex, sourceFrame));
  const { frame } = command.do();
  ownedFrames.push(sourceFrame, frame);
  return frame.get("atoms");
}

describe("ExportFrameCommand", () => {
  it("returns stable scene identities in the same order as dense exported rows", () => {
    const source = chargedSourceFrame();
    const atoms = new AtomSource();
    atoms.setFrame(source);
    atoms.removeEdit(1);
    atoms.setEdit(8, {
      type: "atom",
      atomId: 8,
      element: "C",
      position: { x: 8, y: 0, z: 0 },
    });
    const result = new ExportFrameCommand(
      mockApp(mockSceneIndex(atoms, new BondSource()), source),
    ).do();
    ownedFrames.push(source, result.frame);
    expect(result.atomIds).toEqual([0, 2, 8]);
    expect(
      Array.from(result.frame.get("atoms").copy("x") as Float64Array),
    ).toEqual([0, 0, 8]);
  });
  // ── Basics (passes today — guards the fix against regressing the shape) ──
  it("exports every scene atom with its coordinates and element", () => {
    const out = exportedAtoms();
    expect(out?.nRows).toBe(3);
    expect(Array.from((out?.copy("x") as Float64Array) ?? [])).toEqual([
      0, 1, 0,
    ]);
    expect([...(out?.copy("element") as string[])]).toEqual(["O", "H", "H"]);
  });

  // ── Domain: column integrity, the thing the docstring promises ──────────
  it("carries the source frame's float charge column into the export", () => {
    const out = exportedAtoms();
    expect(out?.keys()).toContain("charge");
    expect(Array.from((out?.copy("charge") as Float64Array) ?? [])).toEqual([
      0.5, -0.25, 0.125,
    ]);
  });

  it("carries the source frame's integer mol_id column into the export", () => {
    // Asserted separately from `charge` so a fix that special-cases one dtype
    // cannot pass: the drop is whitelist-shaped, not float-shaped.
    const out = exportedAtoms();
    expect(out?.keys()).toContain("mol_id");
    expect(
      Array.from((out?.copy("mol_id") as BigUint64Array) ?? [], Number),
    ).toEqual([1, 1, 1]);
  });
});
