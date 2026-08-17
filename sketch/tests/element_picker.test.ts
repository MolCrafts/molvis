import {
  defineMolvisElementPicker,
  MolvisElementPickerElement,
} from "@molcrafts/molvis-core/element-picker";
import { SketchBoard } from "@molcrafts/molvis-sketch";
import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";

const PICKER_TAG = "molvis-element-picker";

function createPicker(): MolvisElementPickerElement {
  const picker = document.createElement(PICKER_TAG);
  if (!(picker instanceof MolvisElementPickerElement)) {
    throw new TypeError(
      `${PICKER_TAG} did not satisfy the shared core picker protocol`,
    );
  }
  document.body.append(picker);
  return picker;
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      right: 300,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  document.body.append(canvas);
  return canvas;
}

function connectPickerToBoard(
  picker: MolvisElementPickerElement,
  board: SketchBoard,
): () => void {
  const onInput = (): void => {
    board.setElement(picker.value);
    board.setTool("atom");
  };
  picker.addEventListener("input", onInput);
  const unsubscribe = board.subscribe((state) => {
    picker.value = state.element;
  });
  return () => {
    picker.removeEventListener("input", onInput);
    unsubscribe();
  };
}

describe("shared element picker Sketch wiring", () => {
  beforeAll(() => {
    defineMolvisElementPicker();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("drives SketchBoard through the shared input protocol", () => {
    const picker = createPicker();
    const board = new SketchBoard();
    board.setTool("bond");
    const disconnect = connectPickerToBoard(picker, board);

    picker.value = "Fe";
    picker.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    expect(board.getElement()).toBe("Fe");
    expect(board.getTool()).toBe("atom");
    disconnect();
  });

  it("syncs programmatic and keyboard board changes back to the picker", () => {
    const picker = createPicker();
    const board = new SketchBoard();
    const canvas = createCanvas();
    board.mount(canvas);
    const disconnect = connectPickerToBoard(picker, board);

    board.setElement("Cl");
    expect(picker.value).toBe("Cl");

    board.setElement("C");
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", bubbles: true }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );

    expect(board.getElement()).toBe("Cl");
    expect(board.getTool()).toBe("atom");
    expect(picker.value).toBe("Cl");

    disconnect();
    board.unmount();
  });
});
