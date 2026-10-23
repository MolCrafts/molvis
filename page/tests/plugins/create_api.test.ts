import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  BaseModifier,
  ModifierCapability,
  ModifierRegistry,
  type Molvis,
  modifierRegistryKey,
} from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { createPluginAPI } from "../../src/plugins/api/create_api";
import {
  modifierUsesLeftConfig,
  resolveModifierPanel,
} from "../../src/plugins/contributions/modifier_panels";
import type { ModifierPanelComponent } from "../../src/plugins/types";

class Probe extends BaseModifier {
  constructor() {
    super(
      "scale-1",
      "Scale X",
      new Set<ModifierCapability>([ModifierCapability.TransformsData]),
    );
  }

  apply(input: Frame): Frame {
    return input;
  }
}

const Panel: ModifierPanelComponent = () => null;

describe("createPluginAPI modifiers", () => {
  it("namespaces the registry key, keeps a short label, and can hide the row", () => {
    const { api, disposeAll } = createPluginAPI(
      {} as Molvis,
      "com.example.demo",
    );
    const key = "plugin.com.example.demo.scale-x";
    api.modifiers.register("scale-x", "Modification", () => new Probe(), {
      label: "Scale X",
      userAddable: false,
      panel: Panel,
      usesLeftConfig: true,
    });
    try {
      const entry = ModifierRegistry.getAvailableModifiers().find(
        (item) => item.name === key,
      );
      expect(entry?.label).toBe("Scale X");
      expect(entry?.userAddable).toBe(false);
      expect(
        ModifierRegistry.getUserAddableModifiers().some(
          (item) => item.name === key,
        ),
      ).toBe(false);
      const made = entry?.factory();
      expect(made).toBeDefined();
      if (!made) return;
      expect(modifierRegistryKey(made)).toBe(key);
      expect(resolveModifierPanel(made)).toBe(Panel);
      expect(modifierUsesLeftConfig(made)).toBe(true);
    } finally {
      disposeAll();
    }
    expect(
      ModifierRegistry.getAvailableModifiers().some(
        (item) => item.name === key,
      ),
    ).toBe(false);
  });
});
