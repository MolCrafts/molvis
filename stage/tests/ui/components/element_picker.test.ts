import type { MolvisElementPickerElement } from "@molcrafts/molvis-core/element-picker";
import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { registerWebComponents } from "../../../src/dom_helpers";
import type { BindingEvent, MenuItem } from "../../../src/mode/types";
import { MolvisSlider } from "../../../src/ui/components/slider";

function createSlider(item: MenuItem): MolvisSlider {
  const slider = document.createElement("molvis-slider");
  if (!(slider instanceof MolvisSlider)) {
    throw new TypeError("molvis-slider was not registered with MolvisSlider");
  }
  slider.data = item;
  document.body.append(slider);
  return slider;
}

function getPicker(slider: MolvisSlider): MolvisElementPickerElement {
  const picker = slider.shadowRoot?.querySelector<MolvisElementPickerElement>(
    "molvis-element-picker",
  );
  if (!picker) {
    throw new Error("element-picker binding did not render the core picker");
  }
  return picker;
}

function getPickerButton(
  picker: MolvisElementPickerElement,
  selector: string,
): HTMLButtonElement {
  const button = picker.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`element picker did not render ${selector}`);
  }
  return button;
}

describe("MolvisSlider element-picker binding", () => {
  beforeAll(() => {
    registerWebComponents();
  });

  afterEach(() => {
    for (const slider of document.querySelectorAll("molvis-slider")) {
      slider.remove();
    }
  });

  it("renders the shared picker and forwards one selected element", () => {
    const actions: BindingEvent[] = [];
    const item: MenuItem = {
      type: "binding",
      bindingConfig: {
        view: "element-picker",
        label: "Element",
        value: "C",
      },
      action(event) {
        actions.push(event);
      },
    };
    const slider = createSlider(item);
    const picker = getPicker(slider);

    expect(picker.value).toBe("C");

    getPickerButton(picker, 'button[part~="trigger"]').click();
    getPickerButton(picker, 'button[data-element="Fe"]').click();

    expect(actions).toEqual([{ value: "Fe" }]);
    expect(picker.value).toBe("Fe");
  });
});
