import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../../src/app";
import { InfoPanel } from "../../../src/ui/panels/info_panel";

function mounted(): { panel: InfoPanel; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const panel = new InfoPanel(null as unknown as MolvisApp);
  panel.mount(host);
  return { panel, host };
}

describe("InfoPanel", () => {
  it("stays bottom-left and shows at most three lines", () => {
    const { panel, host } = mounted();
    expect(panel.element.classList.contains("molvis-info-panel")).toBe(true);

    panel.update(
      [
        "Atom 7 · C",
        "XYZ (1.00, 2.00, 3.00)",
        "charge -0.83",
        "mass 12.01",
        "note tail",
      ].join("\n"),
    );

    const lines = [...panel.element.querySelectorAll(".molvis-info-line")];
    expect(panel.element.classList.contains("visible")).toBe(true);
    expect(lines.map((line) => line.textContent)).toEqual([
      "Atom 7 · C",
      "XYZ (1.00, 2.00, 3.00)",
      "charge -0.83 · mass 12.01 · note tail",
    ]);

    panel.update("");
    expect(panel.element.classList.contains("visible")).toBe(false);
    expect(panel.element.childElementCount).toBe(0);
    panel.unmount();
    host.remove();
  });
});
