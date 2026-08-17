import {
  EventEmitter,
  ModeType,
  type Molvis,
  type MolvisEventMap,
} from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToolsTab } from "../../../../src/ui/modes/edit/ToolsTab";

interface ElementPickerElement extends HTMLElement {
  value: string;
}

interface FakeEditMode {
  type: ModeType.Edit;
  element: string;
  bondOrder: number;
}

interface FakeMolvis {
  readonly mode: FakeEditMode;
  readonly events: EventEmitter<MolvisEventMap>;
}

function asMolvis(fake: FakeMolvis): Molvis {
  return fake as unknown as Molvis;
}

function getElementPicker(host: ParentNode): ElementPickerElement {
  const picker = host.querySelector<ElementPickerElement>(
    "molvis-element-picker",
  );
  expect(picker).not.toBeNull();
  if (!picker) {
    throw new Error("Expected ToolsTab to render molvis-element-picker");
  }
  return picker;
}

function getPickerButton(
  picker: ElementPickerElement,
  selector: string,
): HTMLButtonElement {
  const button = picker.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  if (!button) {
    throw new Error(`Expected element picker button matching ${selector}`);
  }
  return button;
}

describe("ToolsTab", () => {
  it("uses the shared picker to update the active Edit mode element", async () => {
    const mode: FakeEditMode = {
      type: ModeType.Edit,
      element: "C",
      bondOrder: 1,
    };
    const fake: FakeMolvis = {
      mode,
      events: new EventEmitter<MolvisEventMap>(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<ToolsTab app={asMolvis(fake)} />);
    });

    try {
      const picker = getElementPicker(host);
      expect(picker.value).toBe("C");

      await act(async () => {
        getPickerButton(picker, 'button[part~="trigger"]').click();
        getPickerButton(picker, 'button[data-element="Fe"]').click();
      });

      expect(mode.element).toBe("Fe");
      expect(picker.value).toBe("Fe");
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });
});
