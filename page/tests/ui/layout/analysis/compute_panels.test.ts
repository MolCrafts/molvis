import { describe, expect, it } from "@rstest/core";
import {
  computePanelOwnsAtomScope,
  getComputePanel,
  registerComputePanel,
} from "../../../../src/ui/layout/analysis/compute_panels";

describe("registerComputePanel", () => {
  it("stores a panel by id for the sidebar lookup", () => {
    registerComputePanel({
      id: "test.panel",
      ownsAtomScope: true,
      render: () => "ok",
    });
    expect(getComputePanel("test.panel")?.render({} as never)).toBe("ok");
    expect(computePanelOwnsAtomScope("test.panel")).toBe(true);
    expect(getComputePanel("missing")).toBeUndefined();
  });
});
