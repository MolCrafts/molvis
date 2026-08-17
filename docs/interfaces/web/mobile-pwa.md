# Mobile web and PWA

The React host (`page/`) is installable as a Progressive Web App and tuned for
phone-sized viewports. Embeds (notebook cells, VS Code webviews) do **not**
register the service worker; only the standalone `#root` document does.

## Install

1. Serve the page over **HTTPS** with the same COOP/COEP headers the dev server
   sets (`Cross-Origin-Opener-Policy: same-origin`,
   `Cross-Origin-Embedder-Policy: require-corp`). SharedArrayBuffer / WASM
   isolation depends on them.
2. Open the app in Chrome (Android / desktop) or Safari (iOS).
3. **Install** from the toolbar download icon when Chrome offers it, or
   **Settings → App**. On iOS: Safari Share → **Add to Home Screen**
   (toolbar shows a short guide).

Manifest: `page/public/manifest.webmanifest`. Service worker:
`page/public/sw.js`.

## Open from URL

| Query | Effect |
| --- | --- |
| `https://<host>/?pdb=1CRN` | Fetch RCSB `1CRN.pdb` |
| `https://<host>/?url=https://…/mol.pdb` | Fetch that URL (CORS required) |

## Open a structure by platform

| Platform | Best path |
| --- | --- |
| **Any browser** | Open file, or paste a PDB id / URL |
| **Desktop Chrome / Edge (installed)** | Right-click → **Open with → MolVis** (`file_handlers` + `launchQueue`) |
| **Android (installed)** | System **Share → MolVis** (`share_target`) — more reliable than Open with |
| **iOS** | Open file from Files. **No** Open with, **no** Share to PWA |
| **WeChat** | Attachments stay in WeChat. ··· → open in Safari/browser → Open file |

## WeChat (微信)

WeChat’s in-app browser **cannot** register as a file handler for chat
attachments. Clicking a `.pdb` in a chat opens WeChat’s own preview, not MolVis.

What works:

1. **Open in system browser** (⋯ menu) → Open file.
2. On Android after install outside WeChat: Share from Downloads → MolVis.

A dismissible banner appears when `MicroMessenger` is in the user agent.

## Layout notes

- Below 1280px (1580px on coarse pointers) side panels become edge drawers.
- Coarse pointers start with the tools drawer **closed** so the canvas is
  full-bleed.
- Safe-area insets pad the chrome under notches / home indicators
  (`viewport-fit=cover`).
