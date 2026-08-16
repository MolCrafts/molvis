/**
 * Load the `@molcrafts/molvis-stage` viewer CDN bundle for documentation pages.
 *
 * Prefer the copy staged from the npm package
 * (`node_modules/@molcrafts/molvis-stage/dist` → `assets/molvis-stage/`) so
 * `zensical serve` exercises the workspace-linked package. Fall back to the
 * published npm package on jsDelivr only when no staged build exists.
 *
 * molrs is wasm-bindgen bundler-target only; the package's `viewer` entry
 * (emitted as `dist/main.js`) must ship a properly wired WASM module (see
 * stage/rslib.config.ts).
 */
const packageBundle = new URL("../molvis-stage/main.js", import.meta.url);

try {
  await import(packageBundle.href);
} catch (packageError) {
  console.info(
    "MolVis npm package bundle is not staged under assets/molvis-stage; " +
      "loading @molcrafts/molvis-stage from the jsDelivr npm CDN.",
    packageError,
  );
  // dist/main.js only resolves on jsDelivr once 0.2.0 is published; the staged
  // node_modules copy above is the primary path and needs no published release.
  await import(
    "https://cdn.jsdelivr.net/npm/@molcrafts/molvis-stage@0.2.0/dist/main.js"
  );
}
