/**
 * Load the `@molcrafts/molvis-core` elements bundle for documentation pages.
 *
 * Prefer the copy staged from the npm package
 * (`node_modules/@molcrafts/molvis-core/dist` → `assets/molvis-core/`) so
 * `zensical serve` exercises the workspace-linked package. Fall back to the
 * published npm package on jsDelivr only when no staged build exists.
 *
 * molrs is wasm-bindgen bundler-target only; the package's `elements` entry
 * must ship a properly wired WASM module (see core/rslib.config.ts).
 */
const packageBundle = new URL("../molvis-core/elements.js", import.meta.url);

try {
  await import(packageBundle.href);
} catch (packageError) {
  console.info(
    "MolVis npm package bundle is not staged under assets/molvis-core; " +
      "loading @molcrafts/molvis-core from the jsDelivr npm CDN.",
    packageError,
  );
  await import(
    "https://cdn.jsdelivr.net/npm/@molcrafts/molvis-core@latest/dist/elements.js"
  );
}
