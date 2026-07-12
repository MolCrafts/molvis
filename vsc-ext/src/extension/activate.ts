import * as vscode from "vscode";
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
import { sendToWebview } from "./panels/messaging";
import { InMemoryPanelRegistry } from "./panels/panelRegistry";
import { openQuickViewPanel } from "./panels/previewPanel";
import { openEditorPanel } from "./panels/viewerPanel";
import { VsCodeLogger } from "./types";

const DOCS_URL = "https://molvis.molcrafts.org/getting-started/vscode/";

let activePanelRegistry: InMemoryPanelRegistry | undefined;

/**
 * Extension entry point. Registers custom editor, preview/viewer commands,
 * activity-bar launcher, and hot reload.
 */
export function activate(context: vscode.ExtensionContext): void {
  const panelRegistry = new InMemoryPanelRegistry();
  activePanelRegistry = panelRegistry;
  const logger = new VsCodeLogger();
  const fileLoader = new MolecularFileLoader();
  const recentFiles = new RecentFilesStore(context.globalState);
  const launcher = new MolvisLauncherViewProvider(recentFiles);

  const recordRecent = (uri: vscode.Uri | undefined): void => {
    if (!uri) return;
    void recentFiles.add(uri);
  };

  context.subscriptions.push(
    logger,
    recentFiles,
    launcher,
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
    // Activity-bar: native tree launcher (Actions / Recent / Help). No WebGL.
    vscode.window.createTreeView(MolvisLauncherViewProvider.viewType, {
      treeDataProvider: launcher,
      showCollapseAll: false,
    }),
    vscode.commands.registerCommand(
      "molvis.quickView",
      async (arg?: unknown) => {
        // Tree context menus pass a LauncherNode; explorer/commands pass a Uri.
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
    vscode.commands.registerCommand("molvis.openEditor", (arg?: unknown) => {
      const target = uriFromLauncherArg(arg) ?? resolveActiveUri();
      recordRecent(target);
      openEditorPanel(context, panelRegistry, logger, fileLoader, target);
    }),
    vscode.commands.registerCommand("molvis.openStructure", async () => {
      const picked = await pickMolecularUri();
      if (!picked) return;
      recordRecent(picked);
      // Full workspace is the activity-bar primary path for a picked file.
      openEditorPanel(context, panelRegistry, logger, fileLoader, picked);
    }),
    vscode.commands.registerCommand(
      "molvis.openRecentInWorkspace",
      (arg?: unknown) => {
        const target = uriFromLauncherArg(arg);
        if (!target) return;
        recordRecent(target);
        openEditorPanel(context, panelRegistry, logger, fileLoader, target);
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
      ? [
          vscode.commands.registerCommand(
            "molvis._test.getRegisteredPanelViewTypes",
            () => panelRegistry.getRegisteredViewTypes(),
          ),
        ]
      : []),
    ...(context.extensionMode !== vscode.ExtensionMode.Production
      ? [createHotReloadWatcher(context, panelRegistry)]
      : []),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!affectsMolvisSettings(event)) {
        return;
      }

      const message = createApplySettingsMessage();
      // biome-ignore lint/complexity/noForEach: panelRegistry.forEach is a custom async iterator, not Array.forEach
      await panelRegistry.forEach((panel) => {
        sendToWebview(panel.webview, message);
      });
    }),
  );
}

export function getRegisteredPanelViewTypesForTests(): readonly string[] {
  return activePanelRegistry?.getRegisteredViewTypes() ?? [];
}

export function deactivate(): void {}
