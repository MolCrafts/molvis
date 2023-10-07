import { initMolvisApp } from "app_package";

const canvas = document.getElementById("renderCanvas");

let assetsHostUrl;
if (DEV_BUILD) {
    assetsHostUrl = "http://127.0.0.1:8181/";
} else {
    assetsHostUrl = "https://nonlocal-assets-host-url/";
}
const app = initMolvisApp({canvas, assetsHostUrl});
const system = app.system;
system.add_atom({"xyz": [0, 0, 1]});
system.add_atom({"xyz": [0, 0, 2]});
app.run();
