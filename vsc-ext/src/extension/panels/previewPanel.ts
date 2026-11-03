import * as vscode from "vscode";
import type { PageSurface, StructureOutlinePayload } from "../../protocol";
import { createInitMessage } from "../configuration";
import { resolveActiveUri } from "../loading/activeUri";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getPageHtml } from "./html";
import {
  handleDropUri,
  handleRangeMessage,
  handleSaveFile,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

/**
 * A Quick look panel plus the two things a caller needs from it.
 *
 * `setSurface` rather than a mutable field: the panel composes its own title
 * and injects its own surface, so it has to stay the only writer. It is handed
 * back here instead of hung on `WebviewPanelMeta` — that descriptor is shared
 * by stage, sketch, both custom editors and a `WebviewView`, none of which have
 * a chrome to switch, and the registry offers no lookup by panel anyway.
 */
export interface QuickLookHandle {
  panel: vscode.WebviewPanel;
  setSurface(surface: PageSurface): void;
  currentSurface(): PageSurface;
}

export async function openQuickViewPanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
  fileLoader: MolecularFileLoader,
  uri?: vscode.Uri,
  options?: {
    onStructureOutline?: (
      outline: StructureOutlinePayload | null,
      webview: vscode.Webview,
    ) => void;
  },
): Promise<QuickLookHandle> {
  const targetUri = resolveActiveUri(uri);
  const displayName = targetUri ? getDisplayName(targetUri) : undefined;

  // The panel owns its surface and its title. Both had to move in here: the
  // title is re-asserted on every dirty-state change, so a write from outside
  // was reverted the first time the scene changed; and the surface is injected
  // into the document by `getHtml`, so a second copy elsewhere would re-inject
  // a stale value on every html re-set.
  let surface: PageSurface = "canvas";
  let isDirty = false;

  /** `Quick look:`/`MolVis:` + name, from the inputs — never re-parsed. */
  const applyTitle = () => {
    const prefix = surface === "full" ? "MolVis" : "Quick look";
    const base = displayName ? `${prefix}: ${displayName}` : prefix;
    panel.title = isDirty ? `● ${base}` : base;
  };

  const panel = vscode.window.createWebviewPanel(
    "molvis.quickView",
    displayName ? `Quick look: ${displayName}` : "Quick look",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  // Quick look is the one viewer with its chrome switched off, not a second
  // bundle. `surface` rides the document so the first paint is already
  // correct — and it reads the live value, so a promoted panel whose html is
  // re-set does not flash back to canvas and then correct itself.
  const getHtml = () =>
    getPageHtml(panel.webview, context.extensionUri, { surface });
  panel.webview.html = getHtml();

  const reloadPreview = targetUri
    ? async () => {
        await sendLoadedFile(panel.webview, targetUri, fileLoader, logger);
      }
    : undefined;

  panelRegistry.register(panel, {
    getHtml,
    reload: reloadPreview,
    sourceUri: targetUri,
  });

  const messageDisposable = onWebviewMessage(
    panel.webview,
    withErrorHandler(async (message) => {
      switch (message.type) {
        case "ready":
          sendToWebview(panel.webview, createInitMessage(surface));
          if (targetUri) {
            await sendLoadedFile(panel.webview, targetUri, fileLoader, logger);
          }
          break;
        case "saveFile":
          await handleSaveFile(message.data, message.suggestedName, logger);
          break;
        case "dropUri":
          await handleDropUri(
            message.uri,
            panel.webview,
            fileLoader,
            logger,
            message.mode,
          );
          break;
        case "structureOutline":
          options?.onStructureOutline?.(message.outline, panel.webview);
          break;
        case "dirtyStateChanged":
          isDirty = message.isDirty;
          applyTitle();
          break;
        case "surfaceChanged":
          // The user pressed the canvas affordance. Same path as the host
          // command, so the title and the replayed `init` cannot diverge from
          // what is on screen.
          setSurface(message.surface);
          break;
        case "error":
          logger.error(`MolVis: ${message.message}`);
          break;
        default:
          if (await handleRangeMessage(panel.webview, message, logger)) {
            break;
          }
          break;
      }
    }, logger),
  );

  panel.onDidDispose(() => {
    panelRegistry.unregister(panel);
    messageDisposable.dispose();
  });

  const setSurface = (next: PageSurface): void => {
    if (next === surface) return;
    surface = next;
    applyTitle();
    sendToWebview(panel.webview, { type: "setSurface", surface: next });
  };

  return { panel, setSurface, currentSurface: () => surface };
}
