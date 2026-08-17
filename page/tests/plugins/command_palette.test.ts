import { describe, expect, it } from "@rstest/core";
import {
  registerDialog,
  registerModeTab,
  registerToolbarAction,
} from "../../src/plugins/contributions/ui";
import { buildPaletteItems } from "../../src/plugins/ui/CommandPalette";

describe("buildPaletteItems", () => {
  it("does not list a dialog already opened by a toolbar command", () => {
    const cleanups = [
      registerToolbarAction({
        id: "plugin.demo.open-script.toolbar",
        label: "Python: Open script",
        opensDialog: "plugin.demo.script",
        onClick: () => {},
      }),
      registerDialog({
        id: "plugin.demo.script",
        title: "Python script",
        render: () => null,
      }),
      registerModeTab({
        mode: "plugin.demo.python",
        label: "Python",
        order: 50,
      }),
      registerToolbarAction({
        id: "plugin.demo.open-notebook.toolbar",
        label: "Python: Notebook",
        onClick: () => {},
      }),
    ];

    try {
      const items = buildPaletteItems(null);
      const labels = items.map((i) => i.label);

      expect(labels).toContain("Python: Open script");
      expect(labels).toContain("Python: Notebook");
      // Dialog covered by opensDialog — once only via the command.
      expect(labels).not.toContain("Python script");
      // Mode tab covered by a command whose label includes "Python".
      expect(labels).not.toContain("Mode: Python");

      const scriptRows = items.filter(
        (i) => i.label === "Python: Open script" || i.label === "Python script",
      );
      expect(scriptRows).toHaveLength(1);
    } finally {
      for (const dispose of cleanups) dispose();
    }
  });
});
