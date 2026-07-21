/**
 * VSCode editor-tab entry for the full MolVis page (Open Workspace).
 *
 * Must mirror page/src/index.tsx: host mount opts from
 * `window.__MOLVIS_VSCODE_INIT__`, theme bootstrap, and MountOptsProvider.
 * Rendering bare `<App />` skips surface/chrome flags and theme init.
 */
import { bootstrapTheme } from "@/hooks/useTheme";
import { mountMolvisApp } from "@/lib/mount";
import { readMountOptsFromHost } from "@/lib/mount-opts";
import "./main.css";

bootstrapTheme();
// Force dark chrome in the VSCode webview (host theme tokens still apply
// via CSS variables where present; class ensures Tailwind dark: variants).
document.documentElement.classList.add("dark");

const container = document.getElementById("root");
if (container) {
  const hostOpts = readMountOptsFromHost();
  mountMolvisApp(container, {
    ...hostOpts,
    // Host HTML injects mount.surface = "full"; default to full if missing.
    surface: hostOpts.surface ?? "full",
    useShadowDOM: false,
  });
} else {
  console.error("[MolVis] #root missing — Open Workspace webview cannot mount");
}
