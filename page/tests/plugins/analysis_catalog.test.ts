import { describe, expect, it } from "@rstest/core";
import {
  PLUGIN_ANALYSIS_CATEGORY,
  pluginSpecToDefinition,
} from "../../src/plugins/analysis_catalog";
import type { PluginAnalysisSpec } from "../../src/plugins/types";

describe("pluginSpecToDefinition", () => {
  it("maps plugin params into AnalysisDefinition shape for the picker", () => {
    const spec: PluginAnalysisSpec = {
      id: "plugin.com.example.count",
      label: "Count atoms",
      description: "demo",
      params: [
        { name: "scale", label: "Scale", kind: "float", default: 1.5 },
        {
          name: "mode",
          label: "Mode",
          kind: "select",
          default: "a",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
      run: async () => ({ data: { n: 0 } }),
      resultKind: "scalar",
    };

    const def = pluginSpecToDefinition(spec);
    expect(def.id).toBe(spec.id);
    expect(def.category).toBe(PLUGIN_ANALYSIS_CATEGORY.id);
    expect(def.label).toBe("Count atoms");
    expect(def.wasmExport).toBe("");
    expect(def.resultKind).toBe("scalar");
    expect(def.params).toHaveLength(2);
    expect(def.params[0].key).toBe("scale");
    expect(def.params[0].kind).toBe("float");
    expect(def.params[1].kind).toBe("select");
    expect(def.params[1].options).toEqual(["a", "b"]);
  });
});
