import { describe, expect, it } from "@rstest/core";
import {
  ADD_MENU_GROUPS,
  addMenuGroup,
  buildPipelineAddItems,
  filterPipelineAddItems,
  groupPipelineAddItems,
  modifierMenuLabel,
  WRAP_PBC_ID,
  WRAP_PBC_LABEL,
} from "../../../../../src/ui/modes/view/pipeline/pipeline_menu";

function entry(
  name: string,
  category: string,
): {
  entry: { name: string; category: string };
  applicable: boolean;
} {
  return { entry: { name, category }, applicable: true };
}

describe("pipeline add-menu catalog", () => {
  it("maps OVITO registry categories onto one-word Title Case nouns", () => {
    expect([...ADD_MENU_GROUPS]).toEqual([
      "Source",
      "Selection",
      "Modification",
      "Color",
      "Structure",
      "Visualization",
      "Analysis",
      "Other",
    ]);
    expect(addMenuGroup("Coloring")).toBe("Color");
    expect(addMenuGroup("Structure identification")).toBe("Structure");
    expect(addMenuGroup("Selection")).toBe("Selection");
    expect(addMenuGroup("Modification")).toBe("Modification");
    expect(addMenuGroup("Visualization")).toBe("Visualization");
    expect(addMenuGroup("Analysis")).toBe("Analysis");
    expect(addMenuGroup("PluginStuff")).toBe("Other");
  });

  it("sentence-cases Title Case outliers without renaming identity keys", () => {
    expect(modifierMenuLabel("Expression Select")).toBe("Expression select");
    expect(modifierMenuLabel("Clear Selection")).toBe("Clear selection");
    expect(modifierMenuLabel("Select Type")).toBe("Select type");
    expect(modifierMenuLabel("Color by Property")).toBe("Color by property");
    expect(modifierMenuLabel("Slice")).toBe("Slice");
    expect(modifierMenuLabel("Create bonds")).toBe("Create bonds");
  });

  it("lists Wrap PBC under Modification after Slice, as a flag not a modifier", () => {
    const items = buildPipelineAddItems({
      modifiers: [
        entry("Slice", "Modification"),
        entry("Affine transformation", "Modification"),
        entry("Expression Select", "Selection"),
      ],
      hasSources: false,
      wrapEnabled: false,
    });

    const wrap = items.find((item) => item.id === WRAP_PBC_ID);
    expect(wrap).toEqual(
      expect.objectContaining({
        id: WRAP_PBC_ID,
        label: WRAP_PBC_LABEL,
        group: "Modification",
        kind: "wrap",
        checked: false,
      }),
    );
    expect(wrap?.kind).not.toBe("modifier");

    const names = items.map((item) => item.label);
    expect(names.indexOf("Slice")).toBeLessThan(names.indexOf(WRAP_PBC_LABEL));
    expect(names.indexOf(WRAP_PBC_LABEL)).toBeLessThan(
      names.indexOf("Affine transformation"),
    );
  });

  it("still lists Wrap PBC when Slice is absent", () => {
    const items = buildPipelineAddItems({
      modifiers: [entry("Expression Select", "Selection")],
      hasSources: true,
      wrapEnabled: true,
    });
    const wrap = items.find((item) => item.id === WRAP_PBC_ID);
    expect(wrap?.checked).toBe(true);
    expect(wrap?.group).toBe("Modification");
  });

  it("finds Wrap PBC by wrap / pbc / periodic search terms", () => {
    const items = buildPipelineAddItems({
      modifiers: [entry("Slice", "Modification")],
      hasSources: false,
      wrapEnabled: false,
    });

    for (const query of ["wrap", "PBC", "pbc", "periodic", "Wrap PBC"]) {
      const hits = filterPipelineAddItems(items, query);
      expect({ query, labels: hits.map((h) => h.label) }).toEqual({
        query,
        labels: expect.arrayContaining([WRAP_PBC_LABEL]),
      });
    }
  });

  it("search for color hides Identification / Coloring registry wording", () => {
    const items = buildPipelineAddItems({
      modifiers: [
        entry("Color by Property", "Coloring"),
        entry("Steinhardt order", "Structure identification"),
        entry("Slice", "Modification"),
      ],
      hasSources: false,
      wrapEnabled: false,
    });
    const grouped = groupPipelineAddItems(
      filterPipelineAddItems(items, "color"),
    );
    expect(grouped.map((g) => g.group)).toEqual(["Color"]);
    expect(grouped[0]?.items.map((i) => i.label)).toEqual([
      "Color by property",
    ]);
  });

  it("puts file actions under Source, not mixed as root verbs", () => {
    const items = buildPipelineAddItems({
      modifiers: [],
      hasSources: false,
      wrapEnabled: false,
    });
    const grouped = groupPipelineAddItems(items);
    expect(grouped[0]?.group).toBe("Source");
    expect(grouped[0]?.items.map((i) => i.kind)).toEqual([
      "open",
      "add-source",
      "extend",
      "stream",
    ]);
    expect(grouped[0]?.items[0]?.label).toBe("Open…");
    expect(grouped[0]?.items[1]?.disabled).toBe(true);
  });
});
