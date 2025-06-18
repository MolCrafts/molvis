import { Molvis } from "@molvis/core";
import { Vector3 } from "@babylonjs/core";

document.documentElement.lang = "en";
const canvas = document.createElement("canvas") as HTMLCanvasElement;
canvas.id = "molvisCanvas";
const style = document.createElement("style");
style.textContent = `
html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
}
#molvisCanvas {
    width: 100%;
    height: 100%;
    touch-action: none;
}
`;
document.body.appendChild(canvas);
document.head.appendChild(style);

// Initialize Molvis
const app = new Molvis(canvas);

app.modify("type_select", {
  type: "O",
  highlight: true,
});

// app.execute("draw_atom", {
//     x: 0.00000,
//     y: -0.06556,
//     z: 0.00000,
//     name: "O",
//     type: "O",
// });
app.execute("draw_frame", {
  atoms: {
    name: ["O", "H1", "H2"],
    x: [0.0, 0.75695, -0.75695],
    y: [-0.06556, 0.52032, 0.52032],
    z: [0.0, 0.0, 0.0],
    element: ["O", "H", "H"],
  },
  bonds: { bond_i: [0, 0], bond_j: [1, 2] },
  options: {
    atoms: {},
    bonds: {
      radius: 0.05,
    },
  },
});

app.world.camera.target = new Vector3(0, -0.06556, 0);

app.render();

// Handle window resize
window.addEventListener("resize", () => {
  app.resize();
});
