import type { PipelineEntry } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import {
  modifierUsesLeftConfig,
  PLUGIN_MODIFIER_TYPE_ID,
  registerModifierPanel,
  resolveModifierPanel,
} from "../../src/plugins/contributions/modifier_panels";
import type { ModifierPanelComponent } from "../../src/plugins/types";

const Panel: ModifierPanelComponent = () => null;

function tagged(name: string, typeId?: string): PipelineEntry {
  const entry = { name } as PipelineEntry;
  if (typeId) {
    Object.defineProperty(entry, PLUGIN_MODIFIER_TYPE_ID, { value: typeId });
  }
  return entry;
}

describe("registerModifierPanel", () => {
  it("opens the left compute surface only for the tagged modifier", () => {
    const dispose = registerModifierPanel("plugin.com.example.scale-x", Panel, {
      usesLeftConfig: true,
    });
    const ours = tagged("Scale X", "plugin.com.example.scale-x");
    const other = tagged("Scale X", "plugin.other.scale-x");

    expect(resolveModifierPanel(ours)).toBe(Panel);
    expect(modifierUsesLeftConfig(ours)).toBe(true);
    expect(modifierUsesLeftConfig(other)).toBe(false);

    dispose();
    expect(resolveModifierPanel(ours)).toBeNull();
    expect(modifierUsesLeftConfig(ours)).toBe(false);
  });
});
