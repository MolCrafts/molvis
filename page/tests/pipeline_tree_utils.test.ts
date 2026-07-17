import type { Modifier } from "@molvis/core";
import { describe, expect, it } from "@rstest/core";
import {
  buildTree,
  getDescendants,
} from "../src/ui/modes/view/pipeline/tree_utils";

function mod(id: string, sourceOwnerId: string | null = null): Modifier {
  return {
    id,
    name: id,
    enabled: true,
    capabilities: new Set(),
    selectionScopeId: null,
    sourceOwnerId,
    matches: () => false,
    isApplicable: () => true,
    validate: () => ({ valid: true }),
    apply: (frame) => frame,
    getCacheKey: () => id,
    applyVisibility: () => {},
  };
}

describe("pipeline tree utils", () => {
  it("groups children by sourceOwnerId only", () => {
    const source = mod("source");
    const child = mod("draw", "source");
    const scoped = mod("hide");
    scoped.selectionScopeId = "select";

    const tree = buildTree([source, child, scoped]);

    expect(tree.map((node) => node.modifier.id)).toEqual(["source", "hide"]);
    expect(tree[0].children.map((node) => node.modifier.id)).toEqual(["draw"]);
  });

  it("collects source-owned descendants", () => {
    const modifiers = [
      mod("source"),
      mod("draw", "source"),
      mod("leaf", "draw"),
    ];
    expect(getDescendants("source", modifiers).map((m) => m.id)).toEqual([
      "draw",
      "leaf",
    ]);
  });
});
