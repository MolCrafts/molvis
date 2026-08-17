/**
 * Optional full product shell for VS Code ("Open Page").
 * Mounts page package only; Workbench does not use this entry.
 */

import { bootstrapTheme } from "@/hooks/useTheme";
import { mountMolvisApp } from "@/lib/mount";
import "./main.css";

bootstrapTheme();
document.documentElement.classList.add("dark");

const container = document.getElementById("root");
if (container) {
  mountMolvisApp(container, {
    surface: "full",
    useShadowDOM: false,
  });
} else {
  console.error("[MolVis] #root missing — Open Page webview cannot mount");
}
