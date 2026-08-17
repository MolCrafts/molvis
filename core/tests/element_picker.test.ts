import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import {
  defineMolvisElementPicker,
  MolvisElementPickerElement,
} from "../src/element_picker";

const TAG_NAME = "molvis-element-picker";

function createPicker(): MolvisElementPickerElement {
  const picker = document.createElement(TAG_NAME);
  if (!(picker instanceof MolvisElementPickerElement)) {
    throw new TypeError(`${TAG_NAME} was not registered with the picker class`);
  }
  document.body.append(picker);
  return picker;
}

function getShadowRoot(picker: MolvisElementPickerElement): ShadowRoot {
  if (!picker.shadowRoot) {
    throw new Error("element picker did not attach a shadow root");
  }
  return picker.shadowRoot;
}

function getTrigger(picker: MolvisElementPickerElement): HTMLButtonElement {
  const trigger = getShadowRoot(picker).querySelector<HTMLButtonElement>(
    'button[part~="trigger"]',
  );
  if (!trigger) {
    throw new Error("element picker trigger was not rendered");
  }
  return trigger;
}

function getElementButton(
  picker: MolvisElementPickerElement,
  symbol: string,
): HTMLButtonElement {
  const button = getShadowRoot(picker).querySelector<HTMLButtonElement>(
    `button[data-element="${symbol}"]`,
  );
  if (!button) {
    throw new Error(`element picker did not render ${symbol}`);
  }
  return button;
}

describe("MolvisElementPickerElement", () => {
  beforeAll(() => {
    defineMolvisElementPicker();
  });

  afterEach(() => {
    for (const picker of document.querySelectorAll(TAG_NAME)) {
      picker.remove();
    }
  });

  it("defaults to carbon", () => {
    expect(createPicker().value).toBe("C");
  });

  it("normalizes a property value and reflects it to the attribute", () => {
    const picker = createPicker();

    picker.value = "fe";

    expect(picker.value).toBe("Fe");
    expect(picker.getAttribute("value")).toBe("Fe");
  });

  it("normalizes an attribute value into the property", () => {
    const picker = createPicker();

    picker.setAttribute("value", "cl");

    expect(picker.value).toBe("Cl");
    expect(picker.getAttribute("value")).toBe("Cl");
  });

  it("rejects an invalid value without changing the previous value", () => {
    const picker = createPicker();
    picker.value = "Fe";

    expect(() => {
      picker.value = "Xx";
    }).toThrow(TypeError);
    expect(picker.value).toBe("Fe");
    expect(picker.getAttribute("value")).toBe("Fe");
  });

  it("reflects disabled state between property and attribute", () => {
    const picker = createPicker();

    picker.disabled = true;
    expect(picker.hasAttribute("disabled")).toBe(true);

    picker.removeAttribute("disabled");
    expect(picker.disabled).toBe(false);

    picker.setAttribute("disabled", "");
    expect(picker.disabled).toBe(true);
  });

  it("registers the default tag idempotently", () => {
    expect(() => defineMolvisElementPicker()).not.toThrow();
    expect(() => defineMolvisElementPicker()).not.toThrow();
    expect(customElements.get(TAG_NAME)).toBe(MolvisElementPickerElement);
  });

  it("renders one grid button for every element", () => {
    const picker = createPicker();

    expect(
      getShadowRoot(picker).querySelectorAll<HTMLButtonElement>(
        "button[data-element]",
      ),
    ).toHaveLength(118);
  });

  it("dispatches input then change when a user selects iron", () => {
    const picker = createPicker();
    const events: Array<{
      type: string;
      bubbles: boolean;
      composed: boolean;
      value: string;
    }> = [];
    const recordEvent = (event: Event): void => {
      if (!(event.currentTarget instanceof MolvisElementPickerElement)) {
        throw new TypeError("picker event currentTarget was not the picker");
      }
      events.push({
        type: event.type,
        bubbles: event.bubbles,
        composed: event.composed,
        value: event.currentTarget.value,
      });
    };
    picker.addEventListener("input", recordEvent);
    picker.addEventListener("change", recordEvent);

    getTrigger(picker).click();
    getElementButton(picker, "Fe").click();

    expect(events).toEqual([
      { type: "input", bubbles: true, composed: true, value: "Fe" },
      { type: "change", bubbles: true, composed: true, value: "Fe" },
    ]);
  });

  it("uses a smaller trigger when compact is present", () => {
    const picker = createPicker();
    const trigger = getTrigger(picker);
    const regularHeight = trigger.getBoundingClientRect().height;

    picker.setAttribute("compact", "");

    expect(trigger.getBoundingClientRect().height).toBeLessThan(regularHeight);
  });

  it("focuses the value and supports arrow-key selection", () => {
    const picker = createPicker();
    const shadowRoot = getShadowRoot(picker);
    const carbon = getElementButton(picker, "C");
    const nitrogen = getElementButton(picker, "N");

    getTrigger(picker).click();
    expect(shadowRoot.activeElement).toBe(carbon);

    carbon.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(shadowRoot.activeElement).toBe(nitrogen);

    nitrogen.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(picker.value).toBe("N");
  });
});
