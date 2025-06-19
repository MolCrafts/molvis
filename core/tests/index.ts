import { Molvis } from "../src/app";
import { Vector3 } from "@babylonjs/core";

document.documentElement.lang = "en";

// Create a simple mount point
const mountPoint = document.createElement("div");
mountPoint.id = "app-container";
mountPoint.style.cssText = `
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
`;
document.body.appendChild(mountPoint);

// Add basic styles
const style = document.createElement("style");
style.textContent = `
html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
`;
document.head.appendChild(style);

// Initialize Molvis with the new simple API
const app = new Molvis(mountPoint, {
  fitContainer: true,
  showUI: true,
  debug: true
});

// Add multiple frames for testing
// Frame 1: Water molecule
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

// Frame 2: Methane molecule (slightly moved)
app.execute("draw_frame", {
  atoms: {
    name: ["C", "H1", "H2", "H3", "H4"],
    x: [2.0, 2.8, 1.2, 2.8, 1.2],
    y: [0.0, 0.8, 0.8, -0.8, -0.8],
    z: [0.0, 0.8, -0.8, 0.8, -0.8],
    element: ["C", "H", "H", "H", "H"],
  },
  bonds: { bond_i: [0, 0, 0, 0], bond_j: [1, 2, 3, 4] },
  options: {
    atoms: {},
    bonds: {
      radius: 0.05,
    },
  },
});

// Frame 3: Ammonia molecule (NH3)
app.execute("draw_frame", {
  atoms: {
    name: ["N", "H1", "H2", "H3"],
    x: [-2.0, -1.2, -2.8, -2.0],
    y: [0.0, 0.8, 0.0, -0.8],
    z: [0.0, 0.0, 0.8, 0.8],
    element: ["N", "H", "H", "H"],
  },
  bonds: { bond_i: [0, 0, 0], bond_j: [1, 2, 3] },
  options: {
    atoms: {},
    bonds: {
      radius: 0.05,
    },
  },
});

app.world.camera.target = new Vector3(0, 0, 0);
app.render();

// Cleanup is handled automatically when the page unloads
window.addEventListener("beforeunload", () => {
  app.destroy();
});

// Add a simple demo button to test the new API
const demoButton = document.createElement("button");
demoButton.textContent = "Resize to 600x400";
demoButton.style.cssText = `
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 10000;
  padding: 8px 16px;
  background: #007acc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`;

const originalHandler = () => {
  app.setSize(600, 400);
  demoButton.textContent = "Back to Fit Container";
  demoButton.onclick = () => {
    app.enableFitContainer(true);
    demoButton.textContent = "Resize to 600x400";
    demoButton.onclick = originalHandler;
  };
};

demoButton.onclick = originalHandler;
document.body.appendChild(demoButton);
