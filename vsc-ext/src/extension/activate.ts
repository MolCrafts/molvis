import * as vscode from "vscode";
import type { WorkbenchSurface } from "../protocol";
import {
  affectsMolvisSettings,
  createApplySettingsMessage,
} from "./configuration";
import { resolveActiveUri } from "./loading/activeUri";
import { MolecularFileLoader } from "./loading/molecularFileLoader";
import { pickMolecularUri } from "./loading/openStructure";
import { RecentFilesStore } from "./loading/recentFiles";
import { MolvisBinaryEditorProvider } from "./panels/binaryEditorProvider";
import { MolvisEditorProvider } from "./panels/editorProvider";
import { createHotReloadWatcher } from "./panels/hotReload";
import {
  MolvisLauncherViewProvider,
  uriFromLauncherArg,
} from "./panels/launcherView";
import { sendLoadedFile, sendToWebview } from "./panels/messaging";
import { openPagePanel } from "./panels/pagePanel";
import { InMemoryPanelRegistry } from "./panels/panelRegistry";
import { openQuickViewPanel } from "./panels/previewPanel";
import { openSketchQuickViewPanel } from "./panels/sketchQuickViewPanel";
import { MolvisSketchViewProvider } from "./panels/sketchView";
import {
  type OutlineTreeItem,
  StructureOutlineProvider,
} from "./panels/structureOutline";
import {
  focusWorkbenchSurface,
  openWorkbenchPanel,
  WORKBENCH_VIEW_TYPE,
} from "./panels/workbenchPanel";
import type { PanelHandle, StructureOutlinePayload } from "./types";
import { VsCodeLogger } from "./types";

const DOCS_URL = "https://docs.molcrafts.org/molvis/interfaces/vscode/";

const MOLECULAR_EXT = new Set([
  ".pdb",
  ".ent",
  ".brk",
  ".xyz",
  ".extxyz",
  ".exyz",
  ".cif",
  ".mmcif",
  ".data",
  ".lmp",
  ".lammps",
  ".lammpsdata",
  ".dump",
  ".lammpstrj",
  ".lmptrj",
  ".lammpsdump",
  ".sdf",
  ".mol",
  ".cube",
  ".cub",
  ".chgcar",
  ".gro",
  ".mol2",
  ".poscar",
  ".contcar",
  ".vasp",
  ".dcd",
  ".trr",
  ".xtc",
  ".zarr",
]);

let activePanelRegistry: InMemoryPanelRegistry | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const panelRegistry = new InMemoryPanelRegistry();
  activePanelRegistry = panelRegistry;
  const logger = new VsCodeLogger();
  const fileLoader = new MolecularFileLoader();
  const recentFiles = new RecentFilesStore(context.globalState);
  const launcher = new MolvisLauncherViewProvider(recentFiles);

  let activeWorkbench: vscode.WebviewPanel | undefined;

  const outline = new StructureOutlineProvider((indices) => {
    if (!activeWorkbench) return;
    sendToWebview(activeWorkbench.webview, {
      type: "selectAtoms",
      indices,
    });
  });

  const setOutline = (payload: StructureOutlinePayload | null): void => {
    outline.setOutline(payload);
  };

  const recordRecent = (uri: vscode.Uri | undefined): void => {
    if (!uri) return;
    void recentFiles.add(uri);
  };

  const trackWorkbench = (panel: vscode.WebviewPanel): void => {
    activeWorkbench = panel;
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) activeWorkbench = e.webviewPanel;
    });
    panel.onDidDispose(() => {
      if (activeWorkbench === panel) {
        activeWorkbench = undefined;
        outline.clear();
      }
    });
  };

  const openWorkbench = (
    uri?: vscode.Uri,
    surface: WorkbenchSurface = "stage",
  ): vscode.WebviewPanel => {
    // Reuse existing workbench: switch surface instead of opening a second tab.
    if (activeWorkbench) {
      if (uri) {
        // File load always targets stage engine.
        sendToWebview(activeWorkbench.webview, {
          type: "setWorkbenchSurface",
          surface: "stage",
        });
        void sendLoadedFile(activeWorkbench.webview, uri, fileLoader, logger);
      } else {
        focusWorkbenchSurface(activeWorkbench, surface);
      }
      return activeWorkbench;
    }

    const panel = openWorkbenchPanel(
      context,
      panelRegistry,
      logger,
      fileLoader,
      uri,
      {
        onStructureOutline: setOutline,
        // If opening with a structure file, land on stage even if caller said sketch.
        surface: uri ? "stage" : surface,
      },
    );
    trackWorkbench(panel);
    return panel;
  };

  const loadIntoWorkbench = async (uri: vscode.Uri): Promise<void> => {
    recordRecent(uri);
    if (activeWorkbench) {
      sendToWebview(activeWorkbench.webview, {
        type: "setWorkbenchSurface",
        surface: "stage",
      });
      await sendLoadedFile(activeWorkbench.webview, uri, fileLoader, logger);
      return;
    }
    let found: PanelHandle | undefined;
    await panelRegistry.forEach((panel, meta) => {
      if (meta.viewType === WORKBENCH_VIEW_TYPE || !found) {
        found = panel;
      }
    });
    if (found && "reveal" in found) {
      // PanelHandle is structural; workbench panels are WebviewPanel
    }
    if (found) {
      activeWorkbench = found as vscode.WebviewPanel;
      sendToWebview(found.webview, {
        type: "setWorkbenchSurface",
        surface: "stage",
      });
      await sendLoadedFile(found.webview, uri, fileLoader, logger);
      return;
    }
    openWorkbench(uri, "stage");
  };

  context.subscriptions.push(
    logger,
    recentFiles,
    launcher,
    outline,
    MolvisEditorProvider.register(
      context,
      panelRegistry,
      logger,
      fileLoader,
      recentFiles,
    ),
    MolvisBinaryEditorProvider.register(
      context,
      panelRegistry,
      logger,
      fileLoader,
      recentFiles,
    ),
    vscode.window.createTreeView(MolvisLauncherViewProvider.viewType, {
      treeDataProvider: launcher,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView("molvis.outline", {
      treeDataProvider: outline,
      showCollapseAll: true,
    }),
    // Side-bar sketch remains a peer engine entry (also Open Sketch → workbench).
    vscode.window.registerWebviewViewProvider(
      MolvisSketchViewProvider.viewType,
      new MolvisSketchViewProvider(context, panelRegistry, logger),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand(
      "molvis.outline.select",
      (item?: OutlineTreeItem) => {
        if (item) outline.select(item);
      },
    ),
    vscode.commands.registerCommand(
      "molvis.quickView",
      async (arg?: unknown) => {
        const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
        recordRecent(target);
        await openQuickViewPanel(
          context,
          panelRegistry,
          logger,
          fileLoader,
          target,
        );
      },
    ),
    vscode.commands.registerCommand(
      "molvis.quickViewSketch",
      async (arg?: unknown) => {
        const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
        recordRecent(target);
        await openSketchQuickViewPanel(
          context,
          panelRegistry,
          logger,
          fileLoader,
          target,
        );
      },
    ),
    vscode.commands.registerCommand("molvis.openWorkbench", (arg?: unknown) => {
      try {
        const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
        recordRecent(target);
        openWorkbench(target, "stage");
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        logger.error(`MolVis: Open Workbench failed: ${text}`);
      }
    }),
    vscode.commands.registerCommand("molvis.openStage", (arg?: unknown) => {
      try {
        const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
        recordRecent(target);
        openWorkbench(target, "stage");
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        logger.error(`MolVis: Open Stage failed: ${text}`);
      }
    }),
    vscode.commands.registerCommand("molvis.openSketch", () => {
      try {
        openWorkbench(undefined, "sketch");
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        logger.error(`MolVis: Open Sketch failed: ${text}`);
      }
    }),
    vscode.commands.registerCommand("molvis.openPage", () => {
      try {
        openPagePanel(context, panelRegistry, logger);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        logger.error(`MolVis: Open Page failed: ${text}`);
      }
    }),
    vscode.commands.registerCommand(
      "molvis.loadInWorkbench",
      async (arg?: unknown) => {
        const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
        if (!target) return;
        await loadIntoWorkbench(target);
      },
    ),
    vscode.commands.registerCommand("molvis.openStructure", async () => {
      const picked = await pickMolecularUri();
      if (!picked) return;
      await loadIntoWorkbench(picked);
    }),
    vscode.commands.registerCommand(
      "molvis.openRecentInWorkbench",
      (arg?: unknown) => {
        const target = uriFromLauncherArg(arg);
        if (!target) return;
        void loadIntoWorkbench(target);
      },
    ),
    vscode.commands.registerCommand(
      "molvis.removeRecent",
      async (arg?: unknown) => {
        const target = uriFromLauncherArg(arg);
        if (!target) return;
        await recentFiles.remove(target);
      },
    ),
    vscode.commands.registerCommand("molvis.clearRecent", async () => {
      await recentFiles.clear();
    }),
    vscode.commands.registerCommand("molvis.openDocs", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));
    }),
    vscode.commands.registerCommand("molvis.showOutput", () => {
      logger.show();
    }),
    vscode.commands.registerCommand("molvis.save", async () => {
      await panelRegistry.forEachVisible((panel) => {
        sendToWebview(panel.webview, { type: "triggerSave" });
      });
    }),
    vscode.commands.registerCommand("molvis.reload", async () => {
      await panelRegistry.forEachVisible(async (panel, meta) => {
        if (meta.reload) {
          await meta.reload();
          return;
        }
        panel.webview.html = meta.getHtml();
      });
    }),
    ...(context.extensionMode !== vscode.ExtensionMode.Production
      ? [createHotReloadWatcher(context, panelRegistry)]
      : []),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!affectsMolvisSettings(event)) return;
      const message = createApplySettingsMessage();
      // biome-ignore lint/complexity/noForEach: custom async iterator
      await panelRegistry.forEach((panel) => {
        sendToWebview(panel.webview, message);
      });
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== "file") return;
      const ext = doc.uri.path.includes(".")
        ? doc.uri.path.slice(doc.uri.path.lastIndexOf(".")).toLowerCase()
        : "";
      const base = doc.uri.path.split("/").pop()?.toUpperCase() ?? "";
      const isMolecular =
        MOLECULAR_EXT.has(ext) ||
        base === "CHGCAR" ||
        base === "POSCAR" ||
        base === "CONTCAR";
      if (!isMolecular) return;
      if (!activeWorkbench) return;
      void sendLoadedFile(activeWorkbench.webview, doc.uri, fileLoader, logger);
    }),
  );
}

export function getRegisteredPanelViewTypesForTests(): readonly string[] {
  return activePanelRegistry?.getRegisteredViewTypes() ?? [];
}

export function deactivate(): void {}
