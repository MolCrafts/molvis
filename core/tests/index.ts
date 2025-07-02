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
});

// Add multiple frames for testing
// Frame 1: Water molecule
app.execute("draw_frame", {
  frameData: {
    blocks: {
      atoms: {
        name: ["O", "H1", "H2"],
        xyz: [
          [0, 0, 0],
          [0.96, 0, 0],
          [-0.96, 0, 0],
        ],
        element: ["O", "H", "H"],
      },
      bonds: { i: [0, 0], j: [1, 2] },
    },
  },
  options: {
    atoms: {},
    bonds: {
      radius: 0.05,
    },
  },
});

app.world.camera.target = new Vector3(0, 0, 0);
app.start();
