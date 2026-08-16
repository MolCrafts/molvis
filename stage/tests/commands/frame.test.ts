import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { ExportFrameCommand } from "../../src/commands/frame";
import { AtomSource, BondSource } from "../../src/entity_source";
import type { SceneIndex } from "../../src/scene_index";

/**
 * Unit under test: stage/src/commands/frame.ts — ExportFrameCommand
 * (note topic `optimize-staging-followups`, "导出路径仍丢列").
 *
 * The command's docstring CLAIMS the whitelist drop is fixed:
 *
 *   "Returns the frame itself rather than a hand-copied subset of it. The old
 *    implementation emitted a fixed {x, y, z, element} ... whitelist, so a
 *    `charge`, `mol_id`, force or grid column the caller had put in was
 *    silently dropped on the way back out."
 *
 * It is not. `do()` calls `buildFrameFromScene(sceneIndex, { markSaved: false })`
 * with NO `sourceFrame` (frame.ts:50), and `buildFrameFromScene` can only carry
 * non-coordinate atom columns across when it is handed the source frame to read
 * them from (scene_sync.ts:150, proven by
 * tests/build_frame_from_scene.test.ts "keeps source atom columns on commit").
 * Without it the export is still exactly the old x/y/z/element whitelist — the
 * docstring describes a fix that never reached this call site.
 *
 * `buildFrameFromScene` only touches `sceneIndex.metaRegistry.{atoms,bonds}`
 * and `markAllSaved()`, so a mock backed by real AtomSource/BondSource
 * suffices — no BabylonJS scene, no MolvisApp boot.
 *
 * Float goldens are exactly representable in binary (0.5 / -0.25 / 0.125): the
 * value is only copied between columns, never computed on, so an exact
 * assertion cannot be flaky and a tolerance would only hide a narrowing bug.
 */

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
  block.setColF("x", new Float64Array([0, 1, 0]));
  block.setColF("y", new Float64Array([0, 0, 1]));
  block.setColF("z", new Float64Array([0, 0, 0]));
  block.setColStr("element", ["O", "H", "H"]);
  block.setColF("charge", new Float64Array([0.5, -0.25, 0.125]));
  block.setColU32("mol_id", new Uint32Array([1, 1, 1]));
  frame.insertBlock("atoms", block);
  return frame;
}

/** App stand-in: the command reads `world.sceneIndex`; `frame` is HEAD. */
function mockApp(sceneIndex: SceneIndex, head: Frame): MolvisApp {
  return {
    world: { sceneIndex },
    frame: head,
  } as unknown as MolvisApp;
}

function exportedAtoms(): Block | undefined {
  const sourceFrame = chargedSourceFrame();
  const atoms = new AtomSource();
  atoms.setFrame(sourceFrame);
  const sceneIndex = mockSceneIndex(atoms, new BondSource());
  const command = new ExportFrameCommand(mockApp(sceneIndex, sourceFrame));
  return command.do().frame.getBlock("atoms");
}

describe("ExportFrameCommand", () => {
  // ── Basics (passes today — guards the fix against regressing the shape) ──
  it("exports every scene atom with its coordinates and element", () => {
    const out = exportedAtoms();
    expect(out?.nrows()).toBe(3);
    expect(Array.from(out?.copyColF("x") ?? [])).toEqual([0, 1, 0]);
    expect(out?.copyColStr("element")).toEqual(["O", "H", "H"]);
  });

  // ── Domain: column integrity, the thing the docstring promises ──────────
  it("carries the source frame's float charge column into the export", () => {
    const out = exportedAtoms();
    expect(out?.keys()).toContain("charge");
    expect(Array.from(out?.copyColF("charge") ?? [])).toEqual([
      0.5, -0.25, 0.125,
    ]);
  });

  it("carries the source frame's integer mol_id column into the export", () => {
    // Asserted separately from `charge` so a fix that special-cases one dtype
    // cannot pass: the drop is whitelist-shaped, not float-shaped.
    const out = exportedAtoms();
    expect(out?.keys()).toContain("mol_id");
    expect(Array.from(out?.copyColU32("mol_id") ?? [])).toEqual([1, 1, 1]);
  });
});
