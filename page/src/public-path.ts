/**
 * Sets webpack's runtime publicPath from a host-injected global so that
 * async chunks (JS) and the molrs WASM module are fetched from the actual
 * kernel-served origin — not the document's own origin (which in a VSCode
 * notebook webview is `vscode-webview://…`, where the kernel routes do
 * not exist and return 401).
 *
 * Call {@link applyAssetPublicPath} first from `index.tsx` so this runs
 * before any module that might trigger an async chunk load.
 */

declare let __webpack_public_path__: string;

interface AssetBaseWindow {
  __MOLVIS_ASSET_BASE__?: string;
}

/** Apply `__MOLVIS_ASSET_BASE__` to the bundler public path when set. */
export function applyAssetPublicPath(): void {
  if (typeof window === "undefined") return;
  const base = (window as unknown as AssetBaseWindow).__MOLVIS_ASSET_BASE__;
  if (!base) return;
  __webpack_public_path__ = base.endsWith("/") ? base : `${base}/`;
}

// Run while this module evaluates so it wins over later imports in index.tsx.
applyAssetPublicPath();
