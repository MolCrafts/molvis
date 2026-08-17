# `@molcrafts/molvis-core` (workspace-private)

Shared MolVis **core**: the monorepo’s sole `@molcrafts/molrs` import face,
element catalog, and framework-free controls shared by the 2D and 3D hosts.

**Not a consumer-facing product.** Product packages:

- `@molcrafts/molvis-sketch` — 2D
- `@molcrafts/molvis-stage` — 3D
- `@molcrafts/molvis` — root umbrella (re-exports both)

## Imports

```ts
import { Frame, generate3D } from "@molcrafts/molvis-core/molrs";
import {
  normalizeElement,
  PeriodicTable,
  PeriodicTableElements,
} from "@molcrafts/molvis-core/elements";
```

Do **not** import `@molcrafts/molrs` from sketch, stage, or page.

### Element picker

The periodic-table picker is a native Web Component. Registration is explicit
so importing the default core barrel never mutates the global custom-element
registry:

```ts
import {
  defineMolvisElementPicker,
  type MolvisElementPickerElement,
} from "@molcrafts/molvis-core/element-picker";

defineMolvisElementPicker();

const picker = document.createElement(
  "molvis-element-picker",
) as MolvisElementPickerElement;
picker.value = "C";
picker.addEventListener("input", () => {
  console.log(picker.value);
});
```

Use the `compact` attribute in a toolbar and `disabled` to match native input
semantics. User selection emits bubbling, composed `input` followed by
`change`.
