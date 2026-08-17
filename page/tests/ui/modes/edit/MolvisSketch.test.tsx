import { describe, expect, it } from "@rstest/core";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import {
  MolvisSketch,
  type MolvisSketchRef,
} from "../../../../src/ui/modes/edit/MolvisSketch";

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

interface ElementPickerElement extends HTMLElement {
  value: string;
}

function getElementPicker(host: ParentNode): ElementPickerElement {
  const picker = host.querySelector<ElementPickerElement>(
    "molvis-element-picker",
  );
  expect(picker).not.toBeNull();
  if (!picker) {
    throw new Error("Expected MolvisSketch to render molvis-element-picker");
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

async function withRenderedSketch(
  assertion: (host: HTMLDivElement) => void | Promise<void>,
): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MolvisSketch />);
  });
  try {
    await assertion(host);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
}

describe("MolvisSketch", () => {
  it("mounts sketch package chrome (SketchComposer gui)", async () => {
    await withRenderedSketch((host) => {
      expect(host.querySelector(".molvis-sketch-composer")).not.toBeNull();
      expect(
        host.querySelector('.molvis-sketch-composer[data-gui="true"]'),
      ).not.toBeNull();
      expect(host.querySelector('[aria-label="Bond"]')).not.toBeNull();
      expect(
        host.querySelector('[aria-label="Fragment templates"]'),
      ).not.toBeNull();
    });
  });

  it("renders the Stereo tool as a solid wedge", async () => {
    await withRenderedSketch((host) => {
      const glyph = host.querySelector('[aria-label="Stereo"] svg');
      expect(glyph?.classList.contains("lucide-triangle")).toBe(false);
      expect(
        glyph?.querySelector(
          ':scope > polygon[fill="currentColor"], :scope > path[fill="currentColor"]',
        ),
      ).not.toBeNull();
    });
  });

  it("offers SVG/PNG export and moves the same board into a modal", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MolvisSketchRef>();
    await act(async () => {
      root.render(<MolvisSketch ref={ref} />);
    });

    const exportButtons = host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Export"]',
    );
    expect(exportButtons).toHaveLength(1);
    const exportButton = exportButtons[0];
    expect(exportButton?.disabled).toBe(true);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Atom"]')?.click();
    });
    const canvas = host.querySelector("canvas");
    if (canvas) {
      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
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
    }
    await act(async () => {
      canvas?.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 150,
          clientY: 100,
          bubbles: true,
          pointerId: 1,
        }),
      );
    });
    expect(ref.current?.getMoleculeData()?.atoms).toHaveLength(1);
    expect(exportButton?.disabled).toBe(false);

    await act(async () => {
      exportButton?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    expect(
      document.body.querySelector(
        '[role="menuitem"][aria-label="Export as SVG"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '[role="menuitem"][aria-label="Export as PNG"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      exportButton?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    expect(host.querySelector('[aria-label="Pop out sketch"]')).not.toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Pop out sketch"]')
        ?.click();
    });
    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="2D molecule sketch"]',
    );
    expect(dialog).not.toBeNull();
    expect(ref.current?.getMoleculeData()?.atoms).toHaveLength(1);
    // Host actions are portaled into composer chrome (may reparent with pop-out).
    expect(
      document.body.querySelector('[aria-label="Return sketch to panel"]'),
    ).not.toBeNull();

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[aria-label="Return sketch to panel"]',
        )
        ?.click();
    });
    // Controlled dialog unmounts content when closed (no exit-animation hold).
    expect(
      document.body.querySelector(
        '[role="dialog"][aria-label="2D molecule sketch"][data-state="open"]',
      ),
    ).toBeNull();
    expect(ref.current?.getMoleculeData()?.atoms).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("uses the shared picker and keeps it synchronized with board shortcuts", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MolvisSketchRef>();
    await act(async () => {
      root.render(<MolvisSketch ref={ref} />);
    });

    try {
      await act(async () => {
        host.querySelector<HTMLButtonElement>('[aria-label="Atom"]')?.click();
      });

      const picker = getElementPicker(host);
      expect(picker.value).toBe("C");

      await act(async () => {
        getPickerButton(picker, 'button[part~="trigger"]').click();
        getPickerButton(picker, 'button[data-element="Fe"]').click();
      });
      expect(ref.current?.getState()).toMatchObject({
        element: "Fe",
        tool: "atom",
      });
      expect(picker.value).toBe("Fe");

      const canvas = host.querySelector("canvas");
      await act(async () => {
        canvas?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "c", bubbles: true }),
        );
        canvas?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "l", bubbles: true }),
        );
      });
      expect(ref.current?.getState()).toMatchObject({
        element: "Cl",
        tool: "atom",
      });
      expect(picker.value).toBe("Cl");
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("keeps only the last ring template strongly highlighted", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MolvisSketchRef>();
    await act(async () => {
      root.render(<MolvisSketch ref={ref} />);
    });
    try {
      await act(async () => {
        host.querySelector<HTMLButtonElement>('[aria-label="Ring"]')?.click();
      });
      const assoc = () => host.querySelector(".molvis-sketch-composer__assoc");
      expect(
        assoc()?.querySelector('[aria-label="5-membered ring"]'),
      ).not.toBeNull();
      await act(async () => {
        assoc()
          ?.querySelector<HTMLButtonElement>('[aria-label="5-membered ring"]')
          ?.click();
      });
      expect(ref.current?.getState()).toMatchObject({
        ringSize: 5,
        ringKind: "aliphatic",
      });
      await act(async () => {
        assoc()
          ?.querySelector<HTMLButtonElement>('[aria-label="Benzene"]')
          ?.click();
      });
      expect(ref.current?.getState()).toMatchObject({
        ringSize: 6,
        ringKind: "benzene",
      });
      await act(async () => {
        assoc()
          ?.querySelector<HTMLButtonElement>('[aria-label="7-membered ring"]')
          ?.click();
      });
      expect(ref.current?.getState()).toMatchObject({
        ringSize: 7,
        ringKind: "aliphatic",
      });

      const ringOptions = Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          '.molvis-sketch-composer__assoc [aria-label$="-membered ring"], .molvis-sketch-composer__assoc [aria-label="Benzene"]',
        ),
      );
      expect(ringOptions.length).toBe(7);
      expect(
        ringOptions
          .filter((button) => button.getAttribute("aria-pressed") === "true")
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["7-membered ring"]);
      expect(
        ringOptions
          .filter((button) => button.classList.contains("active"))
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["7-membered ring"]);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("hosts a working board and exposes every contextual tool option", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MolvisSketchRef>();
    await act(async () => {
      root.render(<MolvisSketch ref={ref} />);
    });

    expect(host.querySelector(".molvis-sketch-container")).not.toBeNull();
    expect(ref.current?.getMoleculeData()).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled,
    ).toBe(true);
    const initialBondTool = host.querySelector('[aria-label="Bond"]');
    expect(initialBondTool?.getAttribute("aria-pressed")).toBe("true");
    expect(initialBondTool?.classList.contains("active")).toBe(true);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Chain"]')?.click();
    });
    expect(
      host.querySelector('[aria-label="Chain"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host.querySelector('[aria-label="Chain"]')?.getAttribute("title"),
    ).toContain("farther makes more bonds");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Charge"]')?.click();
    });
    expect(
      host.querySelector('[aria-label="Decrease formal charge"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Increase formal charge"]'),
    ).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Stereo"]')?.click();
    });
    expect(host.querySelector('[aria-label="Solid wedge"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Hashed wedge"]')).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Clear stereochemistry"]'),
    ).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Ring"]')?.click();
    });
    expect(host.querySelector('[aria-label="7-membered ring"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="8-membered ring"]')).not.toBeNull();

    const canvas = host.querySelector("canvas");
    if (canvas) {
      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
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
    }
    await act(async () => {
      canvas?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
      canvas?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "l", bubbles: true }),
      );
    });
    expect(
      host.querySelector('[aria-label="Atom"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(getElementPicker(host).value).toBe("Cl");
    expect(
      host.querySelector('[aria-label="Fragment templates"]'),
    ).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps the icon-only color override parallel to the active tool", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MolvisSketchRef>();
    await act(async () => {
      root.render(<MolvisSketch ref={ref} />);
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Atom"]')?.click();
    });
    expect(host.querySelector('[aria-label="Text"]')).toBeNull();
    expect(host.querySelector('[aria-label="Custom text"]')).toBeNull();

    const colorToggle = host.querySelector<HTMLButtonElement>(
      '[aria-label="Color override"]',
    );
    let colorInput = host.querySelector<HTMLInputElement>(
      '[aria-label="Choose override color"]',
    );
    expect(colorToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(colorInput?.disabled).toBe(true);

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Color override"]')
        ?.click();
    });
    expect(
      host.querySelector('[aria-label="Atom"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host
        .querySelector('[aria-label="Color override"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    colorInput = host.querySelector<HTMLInputElement>(
      '[aria-label="Choose override color"]',
    );
    expect(colorInput?.disabled).toBe(false);
    expect(ref.current?.getState()).toMatchObject({
      tool: "atom",
      colorOverrideEnabled: true,
    });
    await act(async () => {
      if (colorInput) setInputValue(colorInput, "#008000");
    });

    const canvas = host.querySelector("canvas");
    if (canvas) {
      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
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
    }
    await act(async () => {
      canvas?.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 150,
          clientY: 100,
          bubbles: true,
          pointerId: 1,
        }),
      );
    });
    expect(ref.current?.getMoleculeData()?.atoms[0]).toMatchObject({
      color: "#008000",
    });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Color override"]')
        ?.click();
    });
    expect(ref.current?.getState()).toMatchObject({
      tool: "atom",
      colorOverrideEnabled: false,
      customColor: "#008000",
    });
    await act(async () => {
      canvas?.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 210,
          clientY: 100,
          bubbles: true,
          pointerId: 2,
        }),
      );
    });
    expect(ref.current?.getMoleculeData()?.atoms[1]?.color).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("disables the canvas and its keyboard surface while the host is busy", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<MolvisSketch disabled />);
    });
    const canvas = host.querySelector("canvas");
    expect(canvas?.tabIndex).toBe(-1);
    expect(canvas?.getAttribute("aria-disabled")).toBe("true");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Bond"]')?.disabled,
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
