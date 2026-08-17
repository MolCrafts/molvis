import * as vscode from "vscode";
import type { WorkbenchSurface } from "../../protocol";

// --- Asset URIs ---

function scriptUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...pathSegments: string[]
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", ...pathSegments),
  );
}

// --- HTML ---

function getNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let nonce = "";
  for (const byte of bytes) {
    nonce += byte.toString(16).padStart(2, "0");
  }
  return nonce;
}

function buildCsp(webview: vscode.Webview, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource} https:`,
    `font-src ${webview.cspSource} https: data:`,
  ].join("; ");
}

const LOADING_CSS = `
      #molvis-loading {
        position: absolute; inset: 0; z-index: 10;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; background: #000; color: #b8b8b8;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        transition: opacity .35s ease;
      }
      #molvis-loading.molvis-loading--hidden { opacity: 0; pointer-events: none; }
      #molvis-loading .molvis-spinner {
        width: 30px; height: 30px; border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, .14); border-top-color: #4aa3ff;
        animation: molvis-spin .8s linear infinite;
      }
      #molvis-loading .molvis-loading__label { letter-spacing: .02em; }
      @keyframes molvis-spin { to { transform: rotate(360deg); } }
`;

export function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();
  const src = scriptUri(webview, extensionUri, "webview", "index.js");
  const csp = buildCsp(webview, nonce);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis</title>
    <style>
      html, body, #molvis-container { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; background: #000; }
      ${LOADING_CSS}
    </style>
  </head>
  <body>
    <div id="molvis-container"></div>
    <div id="molvis-loading">
      <div class="molvis-spinner"></div>
      <div class="molvis-loading__label">Loading MolVis…</div>
    </div>
    <script nonce="${nonce}" type="module" src="${src}"></script>
  </body>
</html>`;
}

/**
 * Workbench shell — tabs for peer engines (Stage | Sketch).
 * Config via postMessage after ready. Initial surface via inject.
 */
export function getWorkbenchHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  opts?: { surface?: WorkbenchSurface },
): string {
  const nonce = getNonce();
  const src = scriptUri(webview, extensionUri, "workbench", "index.js");
  const csp = buildCsp(webview, nonce);
  const surface = opts?.surface === "sketch" ? "sketch" : "stage";
  const init = JSON.stringify({ surface }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis Workbench</title>
    <style>
      html, body { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; background: #1e1e1e; }
      #molvis-workbench {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #ccc;
      }
      .molvis-wb-tabs {
        display: flex; flex: 0 0 auto; gap: 0; background: #252526;
        border-bottom: 1px solid #3c3c3c; user-select: none;
      }
      .molvis-wb-tabs button {
        appearance: none; border: 0; background: transparent; color: #969696;
        padding: 6px 14px; cursor: pointer; border-bottom: 2px solid transparent;
      }
      .molvis-wb-tabs button.is-active {
        color: #fff; border-bottom-color: #0078d4;
      }
      .molvis-wb-tabs button:hover { color: #fff; }
      .molvis-wb-body { position: relative; flex: 1 1 auto; min-height: 0; background: #000; }
      .molvis-wb-body > [data-pane] { position: absolute; inset: 0; }
      ${LOADING_CSS}
    </style>
  </head>
  <body>
    <div id="molvis-workbench">
      <div class="molvis-wb-tabs" role="tablist">
        <button type="button" role="tab" data-tab="stage" class="${surface === "stage" ? "is-active" : ""}" aria-selected="${surface === "stage"}">Stage</button>
        <button type="button" role="tab" data-tab="sketch" class="${surface === "sketch" ? "is-active" : ""}" aria-selected="${surface === "sketch"}">Sketch</button>
      </div>
      <div class="molvis-wb-body">
        <div data-pane="stage" ${surface !== "stage" ? "hidden" : ""}></div>
        <div data-pane="sketch" ${surface !== "sketch" ? "hidden" : ""}></div>
      </div>
    </div>
    <div id="molvis-loading">
      <div class="molvis-spinner"></div>
      <div class="molvis-loading__label">Loading Workbench…</div>
    </div>
    <script nonce="${nonce}">window.__MOLVIS_WORKBENCH__ = ${init};</script>
    <script nonce="${nonce}" type="module" src="${src}"></script>
  </body>
</html>`;
}

export function getSketchHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();
  const src = scriptUri(webview, extensionUri, "sketch", "index.js");
  const csp = buildCsp(webview, nonce);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis Sketch</title>
    <style>
      html, body, #root { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; background: #1e1e1e; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${src}"></script>
  </body>
</html>`;
}

/** Full React product shell (page package). Separate from Workbench engines. */
export function getPageHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();
  const src = scriptUri(webview, extensionUri, "page", "index.js");
  const css = scriptUri(webview, extensionUri, "chunks", "page-styles.css");
  const csp = buildCsp(webview, nonce);
  // Prefer page styles if present; fall back to shared styles name from page build.
  const cssAlt = scriptUri(webview, extensionUri, "chunks", "styles.css");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis</title>
    <link rel="stylesheet" href="${css}">
    <link rel="stylesheet" href="${cssAlt}">
    <style>
      html, body, #root { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${src}"></script>
  </body>
</html>`;
}
