import * as vscode from "vscode";
import type { MolvisWebviewOptions } from "../configuration";

// --- Asset URIs (was webview/assets.ts) ---

function getPreviewScriptUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview", "index.js"),
  );
}

function getViewerScriptUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "viewer", "index.js"),
  );
}

function getViewerCssUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "chunks", "styles.css"),
  );
}

// --- HTML generation (was webview/htmlFactory.ts) ---

function getNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
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
    `connect-src ${webview.cspSource} https:`,
    `font-src ${webview.cspSource} https: data:`,
  ].join("; ");
}

export function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();
  const scriptUri = getPreviewScriptUri(webview, extensionUri);
  const csp = buildCsp(webview, nonce);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Molvis</title>
    <style>
      html, body, #molvis-container { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <div id="molvis-container"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}

export function getViewerHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options?: MolvisWebviewOptions,
): string {
  const nonce = getNonce();
  const scriptUri = getViewerScriptUri(webview, extensionUri);
  const cssUri = getViewerCssUri(webview, extensionUri);
  const csp = buildCsp(webview, nonce);
  const serializedOptions = JSON.stringify(options ?? {}).replace(
    /</g,
    "\\u003c",
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis Viewer</title>
    <link rel="stylesheet" href="${cssUri}">
    <style>
      html, body, #root { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__MOLVIS_VSCODE_INIT__ = ${serializedOptions};</script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}
