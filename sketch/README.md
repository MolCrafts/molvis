# @molcrafts/molvis-sketch

Canvas-based 2D molecule sketch editor for MolVis. It provides an editable
molecular graph, undoable commands, hit testing, viewport controls, optional
icon toolbars (`SketchComposer` with a stage-like `gui` flag), and a state API
for custom host chrome.

## Install

```sh
npm install @molcrafts/molvis-sketch
```

## Basic usage

### With built-in chrome (`gui: true`, default)

```ts
import { SketchComposer } from "@molcrafts/molvis-sketch";

const host = document.querySelector<HTMLElement>("#host");
if (!host) throw new Error("missing host");

// Icon rails + fragment templates + canvas. Same idea as stage `gui`.
const composer = new SketchComposer({ gui: true });
composer.mount(host);

composer.board.setTool("bond");
// Host-only actions: append into composer.extraSlot (common rail, no overlay)
composer.unmount();
```

### Host theming (Tailwind / design tokens)

Chrome **and** canvas colors are driven by `--msk-*` tokens
(`SKETCH_TOKEN_DEFAULTS` / `SKETCH_CSS_VARS` in `style/tokens.ts`). A product
shell maps its design tokens without rewriting rails or hardcoding hex in
render code:

```html
<div class="molvis-sketch-host" style="
  --msk-rail-bg: var(--color-muted);
  --msk-stage-bg: var(--color-canvas);
  --msk-ink: var(--color-foreground);
  --msk-active-ink: var(--color-accent);
  --msk-active-fg: var(--color-accent-foreground);
">
  <!-- composer mounts here -->
</div>
```

| Canvas field | Token |
|---|---|
| paper (`background`) | `--msk-stage-bg` |
| bonds / skeleton (`bondStroke`, `labelFill`) | `--msk-ink` |
| selection / hover / marquee | `--msk-active-ink` |
| color-picker default | `--msk-custom-default` or derived from `--msk-active-ink` |

MolVis `page` maps the full set in `.molvis-sketch-host` (`styles/tailwind.css`).
Composer re-resolves on mount and on `molvis:theme-change`.

**Not** UI tokens: ChemDraw/ACS heteroatom label colors (`SKETCH_ELEMENT_COLORS`)
are scientific structure-formula conventions.


### Headless / host-owned chrome (`gui: false`)

```ts
import { SketchBoard } from "@molcrafts/molvis-sketch";

const canvas = document.querySelector<HTMLCanvasElement>("#sketch");
if (!canvas) throw new Error("missing sketch canvas");

const board = new SketchBoard();
board.mount(canvas);
board.resize(canvas.clientWidth, canvas.clientHeight);

board.setTool("bond");
board.setBondOrder(1);

const unsubscribe = board.subscribe((state) => {
  undoButton.disabled = !state.canUndo;
  redoButton.disabled = !state.canRedo;
});

// Call these when the host is torn down.
unsubscribe();
board.unmount();
```


The board accepts and returns immutable `MoleculeData` snapshots:

```ts
const data = board.getMoleculeData();
board.loadMoleculeData(data);
const frame = board.toFrame();
```

SVG and PNG exports are fitted to the molecule and omit editor-only selection,
hover, marquee, and gesture feedback:

```ts
const svg = board.toSvg({ width: 1200, height: 800 });
const png = await board.toPng({
  width: 1200,
  height: 800,
  pixelRatio: 2,
});
```

## Editor controls

- Drag with the bond or chain tool to place connected atoms; both tools can
  start on empty canvas. Chain creates at least two fixed-length single bonds
  in a carbon zig-zag with 120° internal angles; drag farther to add more
  segments, while shorter drags are ignored.
- Drag selected atoms or bonds with the select tool. Drag empty canvas for a
  marquee selection.
- Attach 3–8 membered rings to empty canvas, atoms, or bonds.
- Color is an independent override, not a drawing tool. Enable it while using
  Atom, Bond, Chain, Ring, Charge, or Stereo to color affected content; disable
  it to use element and theme defaults. A current selection can be recolored or
  reset as one undoable edit.
- Use the mouse wheel to zoom and hold Space while dragging to pan.
- Use Undo/Redo for every molecular edit. Loading a molecule starts a fresh
  history root.

The package is ESM-only and ships TypeScript declarations.

Documentation and static pages that only need the `<molvis-sketch>` tag
should install `@molcrafts/molvis-sketch-viewer` and load `dist/main.js`.
Bundlers that already import this engine can call `defineMolvisSketch` from
`@molcrafts/molvis-sketch-viewer/element`.
