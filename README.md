# Molvis

Molvis is an interactive molecular visualization toolkit built on top of [Babylon.js](https://www.babylonjs.com/). This repository is organized as a monorepo containing multiple packages:

- **core/** – the TypeScript library that implements the rendering engine and main API.
- **standalone/** – a React based web application for exploring molecules in the browser.
- **widget/** – a Python package that provides a Jupyter widget.

## Getting started

Install all dependencies:

```bash
npm install
```

During development you can run each package individually:

```bash
npm run dev:core        # develop the core library
npm run dev:standalone  # start the standalone web app
npm run dev:widget      # build the Jupyter widget in watch mode
```

## Example

A minimal example using the core library to create and visualize molecules:

```ts
import { Molvis } from 'molvis';
import { Molecule, Bond } from 'molvis/system';

const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const app = new Molvis(canvas);

// Create a water molecule using the chemical API
const water = new Molecule('水分子', 'H2O');

// Define and add atoms
const oxygen = water.def_atom({ element: 'O', position: { x: 0, y: 0, z: 0 } });
water.add_atom(oxygen);

const hydrogen1 = water.def_atom({ element: 'H', position: { x: 0.96, y: 0, z: 0 } });
water.add_atom(hydrogen1);

const hydrogen2 = water.def_atom({ element: 'H', position: { x: -0.24, y: 0.92, z: 0 } });
water.add_atom(hydrogen2);

// Create chemical bonds
const bond1 = new Bond(oxygen, hydrogen1);
const bond2 = new Bond(oxygen, hydrogen2);

console.log(`Molecular weight: ${water.getMolecularWeight()}`);
console.log(`Bond lengths: ${bond1.getLength()}, ${bond2.getLength()}`);

// Render the scene
app.render();
```

The molecular system uses an Entity-Component-System (ECS) architecture internally, but exposes a clean object-oriented chemical API with `Molecule`, `Residue`, `Crystal`, `Bond`, and `Atom` classes.

## License

This project is distributed under the BSD-3-Clause license. See the [LICENSE](LICENSE) file for details.
