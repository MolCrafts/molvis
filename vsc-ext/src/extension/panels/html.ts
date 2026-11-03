import * as vscode from "vscode";
import { type PageMountInject, renderMountInject } from "./mountInject";

// --- Asset URIs ---

/** Bump when webview JS changes under the same extension version so
 *  Chromium does not reuse a cached `shared.js` after `--force` install. */
const WEBVIEW_ASSET_REV = "quicklook-page-20";

function scriptUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...pathSegments: string[]
): vscode.Uri {
  const uri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", ...pathSegments),
  );
  return uri.with({ query: `v=${WEBVIEW_ASSET_REV}` });
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
    `script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval' blob:`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource} https: blob:`,
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
      /* A load onto a scene that already has data must not black it out. */
      #molvis-loading.molvis-loading--busy { background: rgba(0, 0, 0, .58); }
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

/** Full React product shell (`page/`). Separate from Stage / Sketch tabs. */
export function getPageHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mount?: PageMountInject,
): string {
  const nonce = getNonce();
  const src = scriptUri(webview, extensionUri, "page", "index.js");
  const css = scriptUri(webview, extensionUri, "chunks", "page-styles.css");
  const csp = buildCsp(webview, nonce);
  const inject = renderMountInject(nonce, mount);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MolVis</title>
    <link rel="stylesheet" href="${css}">
    <style>
      html, body, #root { position: absolute; inset: 0; margin: 0; padding: 0; overflow: hidden; }
      ${LOADING_CSS}
    </style>
  </head>
  <body>
    ${inject}
    <div id="root"></div>
    <div id="molvis-loading">
      <div class="molvis-spinner"></div>
      <div class="molvis-loading__label">Loading MolVis…</div>
    </div>
    <script nonce="${nonce}" type="module" src="${src}"></script>
  </body>
</html>`;
}
