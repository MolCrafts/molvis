import * as vscode from "vscode";
import {
  affectsMolvisSettings,
  createApplySettingsMessage,
  getDefaultViewer,
} from "./configuration";
import { resolveActiveUri } from "./loading/activeUri";
import { MolecularFileLoader } from "./loading/molecularFileLoader";
import {
  isBinaryTrajectoryPath,
  isMolecularPath,
  isSketchPath,
} from "./loading/molecularMatch";
import { pickMolecularUri } from "./loading/openStructure";
import { getDisplayName, mrecStoreRootPath } from "./loading/pathUtils";
import { RecentFilesStore } from "./loading/recentFiles";
import { MolvisBinaryEditorProvider } from "./panels/binaryEditorProvider";
import { MolvisEditorProvider } from "./panels/editorProvider";
import { MolvisFilesViewProvider, uriFromFilesArg } from "./panels/filesView";
import { createHotReloadWatcher } from "./panels/hotReload";
import { sendLoadedFile, sendToWebview } from "./panels/messaging";
import { openPagePanel } from "./panels/pagePanel";
import { InMemoryPanelRegistry } from "./panels/panelRegistry";
import {
  openQuickViewPanel,
  type QuickLookHandle,
} from "./panels/previewPanel";
import { openSketchPanel } from "./panels/sketchPanel";
import { openSketchQuickViewPanel } from "./panels/sketchQuickViewPanel";
import { openStagePanel } from "./panels/stagePanel";
import {
  type OutlineTreeItem,
  StructureOutlineProvider,
} from "./panels/structureOutline";
import { VsCodeLogger } from "./types";

const DOCS_URL = "https://docs.molcrafts.org/molvis/interfaces/vscode/";

let activePanelRegistry: InMemoryPanelRegistry | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const panelRegistry = new InMemoryPanelRegistry();
  activePanelRegistry = panelRegistry;
  const logger = new VsCodeLogger();
  const fileLoader = new MolecularFileLoader();
  const recentFiles = new RecentFilesStore(context.globalState);
  const files = new MolvisFilesViewProvider(recentFiles);

  let activeStage: vscode.WebviewPanel | undefined;
  let activePage: vscode.WebviewPanel | undefined;
  /**
   * File the Page tab currently shows. Re-sending it costs a whole reload —
   * two webviews cannot share a parsed frame, so the payload crosses the host
   * channel again (a network hop on Remote-SSH) and molrs re-parses it.
   */
  let activePageUri: string | undefined;
  /**
   * Most recently focused Quick look panel and the file it shows. A webview
   * panel's tab carries no URI, so "promote this Quick look to the Page" has
   * no other way to learn what to reopen.
   */
  let activeQuickView:
    | {
        panel: vscode.WebviewPanel;
        uri?: vscode.Uri;
        /** Lets "Open in Page" hand the surface over in place. */
        quickLook: QuickLookHandle;
      }
    | undefined;

  /**
   * Keeps the title-bar affordances honest: a promoted panel keeps its
   * `molvis.quickView` view type, so `when` clauses that only test the view
   * type would still offer "Open in Page" on a tab that already shows the full
   * interface.
   */
  const applySurfaceContextKey = (surface: "canvas" | "full") => {
    void vscode.commands.executeCommand(
      "setContext",
      "molvis.activeSurfaceIsCanvas",
      surface === "canvas",
    );
  };
  let activeSketch: vscode.WebviewPanel | undefined;

  const stageOutline = new StructureOutlineProvider(
    "molvis.stageOutline.select",
    (selection, source) => {
      // The publisher first: a Quick look outline must select in that Quick
      // look, not in whichever Stage tab happens to be open.
      const target = source ?? activeStage?.webview;
      if (!target) return;
      sendToWebview(target, { type: "selectAtoms", ...selection });
    },
    "molvis.hasStageOutline",
  );
  const sketchOutline = new StructureOutlineProvider(
    "molvis.sketchOutline.select",
    (selection) => {
      if (!activeSketch) return;
      sendToWebview(activeSketch.webview, {
        type: "selectAtoms",
        ...selection,
      });
    },
    "molvis.hasSketchOutline",
  );

  /**
   * Register a command whose failures are attributable.
   *
   * Without this an exception surfaces as a bare workbench error with no
   * MolVis frame in the stack, which is indistinguishable from VS Code's own
   * failures — exactly the ambiguity that made a "clicking Quick look throws"
   * report unanswerable.
   */
  const command = (
    id: string,
    run: (...args: never[]) => unknown,
  ): vscode.Disposable =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        return await run(...args);
      } catch (err) {
        const detail =
          err instanceof Error ? (err.stack ?? err.message) : String(err);
        logger.error(`MolVis: command ${id} failed — ${detail}`);
      }
    });

  const recordRecent = (uri: vscode.Uri | undefined): void => {
    if (!uri) return;
    void recentFiles.add(uri);
  };

  const openStage = (uri?: vscode.Uri): vscode.WebviewPanel => {
    if (activeStage) {
      if (uri) {
        void sendLoadedFile(
          activeStage.webview,
          uri,
          fileLoader,
          logger,
          "augment",
        );
      }
      activeStage.reveal(
        activeStage.viewColumn ?? vscode.ViewColumn.One,
        false,
      );
      return activeStage;
    }
    const panel = openStagePanel(
      context,
      panelRegistry,
      logger,
      fileLoader,
      uri,
      {
        onStructureOutline: (payload) => stageOutline.setOutline(payload),
      },
    );
    activeStage = panel;
    panel.onDidDispose(() => {
      if (activeStage === panel) {
        activeStage = undefined;
        stageOutline.clear();
      }
    });
    return panel;
  };

  /**
   * Open (or reuse) the Page tab. Reuse matters here: a fresh Page webview
   * re-fetches ~18 MB of bundle + wasm, which over Remote-SSH is the whole
   * "nothing happens for a while" after the click.
   */
  const openPage = (
    uri?: vscode.Uri,
    viewColumn?: vscode.ViewColumn,
  ): vscode.WebviewPanel => {
    if (activePage) {
      const wanted = uri?.toString();
      if (wanted && wanted !== activePageUri) {
        activePageUri = wanted;
        void sendLoadedFile(
          activePage.webview,
          uri as vscode.Uri,
          fileLoader,
          logger,
        );
      } else if (wanted) {
        logger.info(
          `MolVis: ${getDisplayName(uri as vscode.Uri)} is already open in the Page — revealing it instead of reloading.`,
        );
      }
      activePage.reveal(
        viewColumn ?? activePage.viewColumn ?? vscode.ViewColumn.One,
        false,
      );
      return activePage;
    }
    const panel = openPagePanel(context, panelRegistry, logger, fileLoader, {
      uri,
      viewColumn,
    });
    activePage = panel;
    activePageUri = uri?.toString();
    panel.onDidDispose(() => {
      if (activePage === panel) {
        activePage = undefined;
        activePageUri = undefined;
      }
    });
    return panel;
  };

  const openSketch = (uri?: vscode.Uri): vscode.WebviewPanel => {
    if (activeSketch) {
      if (uri) {
        void sendLoadedFile(activeSketch.webview, uri, fileLoader, logger);
      }
      activeSketch.reveal(
        activeSketch.viewColumn ?? vscode.ViewColumn.One,
        false,
      );
      return activeSketch;
    }
    const panel = openSketchPanel(
      context,
      panelRegistry,
      logger,
      fileLoader,
      uri,
      {
        onStructureOutline: (payload) => sketchOutline.setOutline(payload),
      },
    );
    activeSketch = panel;
    panel.onDidDispose(() => {
      if (activeSketch === panel) {
        activeSketch = undefined;
        sketchOutline.clear();
      }
    });
    return panel;
  };

  const loadIntoStage = async (uri: vscode.Uri): Promise<void> => {
    recordRecent(uri);
    if (activeStage) {
      await sendLoadedFile(activeStage.webview, uri, fileLoader, logger);
      activeStage.reveal(
        activeStage.viewColumn ?? vscode.ViewColumn.One,
        false,
      );
      return;
    }
    openStage(uri);
  };

  const loadIntoSketch = async (uri: vscode.Uri): Promise<void> => {
    recordRecent(uri);
    if (activeSketch) {
      await sendLoadedFile(activeSketch.webview, uri, fileLoader, logger);
      activeSketch.reveal(
        activeSketch.viewColumn ?? vscode.ViewColumn.One,
        false,
      );
      return;
    }
    openSketch(uri);
  };

  context.subscriptions.push(
    logger,
    recentFiles,
    files,
    stageOutline,
    sketchOutline,
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
    vscode.window.createTreeView(MolvisFilesViewProvider.viewType, {
      treeDataProvider: files,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView("molvis.stageOutline", {
      treeDataProvider: stageOutline,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView("molvis.sketchOutline", {
      treeDataProvider: sketchOutline,
      showCollapseAll: true,
    }),
    command("molvis.stageOutline.select", (item?: OutlineTreeItem) => {
      if (item) stageOutline.select(item);
    }),
    command("molvis.sketchOutline.select", (item?: OutlineTreeItem) => {
      if (item) sketchOutline.select(item);
    }),
    command("molvis.quickView", async (arg?: unknown) => {
      const target = uriFromFilesArg(arg) ?? resolveActiveUri();
      recordRecent(target);
      if (getDefaultViewer() === "page") {
        // `molvis.defaultViewer` = page: skip Quick look entirely rather
        // than loading the file here and again on promote.
        openPage(target);
        return;
      }
      const quickLook = await openQuickViewPanel(
        context,
        panelRegistry,
        logger,
        fileLoader,
        target,
        {
          onStructureOutline: (payload, webview) =>
            stageOutline.setOutline(payload, webview),
        },
      );
      const { panel } = quickLook;
      const trackAsQuickView = () => {
        activeQuickView = { panel, uri: target, quickLook };
      };
      trackAsQuickView();
      panel.onDidChangeViewState(() => {
        // Promotion is terminal for the Quick look identity. Without the
        // surface check, refocusing a promoted tab re-registered it here and
        // left it in both trackers at once.
        if (panel.active && quickLook.currentSurface() === "canvas") {
          trackAsQuickView();
        }
        if (panel.active) applySurfaceContextKey(quickLook.currentSurface());
      });
      panel.onDidDispose(() => {
        if (activeQuickView?.panel === panel) activeQuickView = undefined;
        if (activePage === panel) {
          activePage = undefined;
          activePageUri = undefined;
        }
      });
    }),
    command("molvis.showSource", async () => {
      let source: vscode.Uri | undefined;
      await panelRegistry.forEachVisible((_panel, meta) => {
        if (!source && meta.sourceUri) source = meta.sourceUri;
      });
      source = source ?? resolveActiveUri();
      if (!source) return;
      if (isBinaryTrajectoryPath(source.fsPath)) return;
      if (mrecStoreRootPath(source.path)) return;
      await vscode.window.showTextDocument(source);
    }),
    command("molvis.quickViewSketch", async (arg?: unknown) => {
      const target = uriFromFilesArg(arg) ?? resolveActiveUri();
      recordRecent(target);
      await openSketchQuickViewPanel(
        context,
        panelRegistry,
        logger,
        fileLoader,
        target,
        {
          onStructureOutline: (payload) => sketchOutline.setOutline(payload),
        },
      );
    }),
    command("molvis.openStage", (arg?: unknown) => {
      const target = uriFromFilesArg(arg) ?? resolveActiveUri();
      recordRecent(target);
      openStage(target);
    }),
    command("molvis.openPage", (arg?: unknown) => {
      // Same rule as Open Stage: whatever file is in front of the user comes
      // along, so "open this in the Page" is one click either way.
      const target =
        uriFromFilesArg(arg) ??
        (activeQuickView?.panel.active ? activeQuickView.uri : undefined) ??
        resolveActiveUri();
      recordRecent(target);
      openPage(target);
    }),
    command("molvis.openInPage", async () => {
      // Two paths, and they differ. Our own webview panel switches its chrome
      // on where it stands. A custom editor still has to be closed and a Page
      // opened in its place — those two are not migrated yet, so promoting one
      // still costs a reload. That half disappears with their migration.
      const quick = activeQuickView?.panel.active ? activeQuickView : undefined;
      if (quick) {
        // Same webview, same engine, same parsed frame — the file is not read
        // again and nothing crosses the connection twice.
        quick.quickLook.setSurface("full");
        // It is a Page now. Leaving it in `activeQuickView` would keep it in
        // two trackers, and leaving `activePage` empty would make the next
        // "Open Page" build a second ~10.6 MB webview for the same file.
        activePage = quick.panel;
        activePageUri = quick.uri?.toString();
        activeQuickView = undefined;
        applySurfaceContextKey("full");
        recordRecent(quick.uri);
        return;
      }
      const uri = resolveActiveUri();
      const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor",
      );
      if (!uri) {
        // Nothing to carry over: say so rather than opening a blank Page and
        // leaving the user to guess whether the file failed to load.
        logger.warn(
          "MolVis: Open in Page found no file on the active tab — opening an empty Page.",
        );
      }
      recordRecent(uri);
      openPage(uri, viewColumn);
    }),
    command("molvis.openSketch", (arg?: unknown) => {
      const target = uriFromFilesArg(arg) ?? resolveActiveUri();
      const sketchUri =
        target && isSketchPath(target.fsPath) ? target : undefined;
      if (sketchUri) recordRecent(sketchUri);
      openSketch(sketchUri);
    }),
    command("molvis.openStructure", async () => {
      const picked = await pickMolecularUri();
      if (!picked) return;
      if (isSketchPath(picked.fsPath)) {
        await loadIntoSketch(picked);
        return;
      }
      await loadIntoStage(picked);
    }),
    command("molvis.removeRecent", async (arg?: unknown) => {
      const target = uriFromFilesArg(arg);
      if (!target) return;
      await recentFiles.remove(target);
    }),
    command("molvis.clearRecent", async () => {
      await recentFiles.clear();
    }),
    command("molvis.refreshFiles", () => {
      void files.refreshWorkspace();
    }),
    command("molvis.openDocs", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));
    }),
    command("molvis.showOutput", () => {
      logger.show();
    }),
    command("molvis.save", async () => {
      await panelRegistry.forEachVisible((panel) => {
        sendToWebview(panel.webview, { type: "triggerSave" });
      });
    }),
    command("molvis.reload", async () => {
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
      if (!isMolecularPath(doc.uri.fsPath)) return;
      if (isSketchPath(doc.uri.fsPath)) {
        if (!activeSketch) return;
        void sendLoadedFile(activeSketch.webview, doc.uri, fileLoader, logger);
        return;
      }
      if (!activeStage) return;
      void sendLoadedFile(
        activeStage.webview,
        doc.uri,
        fileLoader,
        logger,
        "augment",
      );
    }),
  );
}

export function getRegisteredPanelViewTypesForTests(): readonly string[] {
  return activePanelRegistry?.getRegisteredViewTypes() ?? [];
}

export function deactivate(): void {}
