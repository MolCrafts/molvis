import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { SelectModifier } from "../../src/modifiers/SelectModifier";
import { generateNatoId } from "../../src/pipeline/nato_ids";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { Session } from "../../src/pipeline/session";

/**
 * `MolvisApp.createManualSelection` names the new selection from the
 * modifier ids, which do not include the session. The pipeline then replaces
 * that name, so the app must report `mod.id` — not the name it proposed.
 */
describe("manual selection beside a session", () => {
  it("is stored under an id other than the session's", () => {
    const pipeline = new ModifierPipeline();
    const session = new Session("session", "ws://127.0.0.1/ws", () => {});
    pipeline.setSession(session);

    const proposed = generateNatoId(
      new Set(pipeline.modifiers().map((m) => m.id)),
    );
    // The premise: the proposed name collides with the session's.
    expect(proposed).toBe(session.id);
    const mod = new SelectModifier(proposed, [7], "replace", []);
    pipeline.addModifier(mod);

    expect(mod.id).not.toBe(session.id);
    const stored = pipeline.modifiers().find((m) => m.id === mod.id);
    expect(stored).toBe(mod);
    expect(mod.isManual).toBe(true);
    expect([...mod.selectionSource]).toEqual([7]);
  });
});
