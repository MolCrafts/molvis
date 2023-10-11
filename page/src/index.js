import { initMolvisApp } from "molvis";

document.body.style.width = "100%";
document.body.style.height = "100%";
document.body.style.overflow = "hidden";

const canvas = document.createElement("canvas");
canvas.id = "renderCanvas";
canvas.style.width = "100%";
canvas.style.height = "100%";
document.body.appendChild(canvas);

let assetsHostUrl;
if (DEV_BUILD) {
    assetsHostUrl = "http://127.0.0.1:8181/";
} else {
    assetsHostUrl = "https://nonlocal-assets-host-url/";
}
const app = initMolvisApp({ canvas: canvas, assetsHostUrl: assetsHostUrl});
const system = app.system;
system.add_atom({"xyz": [0, 0, 1]});
app.run();
