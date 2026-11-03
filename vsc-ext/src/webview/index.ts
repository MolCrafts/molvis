export {};

const container = document.getElementById("molvis-container");
if (!container) {
  throw new Error("Missing container");
}

const loading = document.getElementById("molvis-loading");
const label = loading?.querySelector<HTMLElement>(".molvis-loading__label");

function showLoading(text: string): void {
  if (!loading) return;
  if (label) label.textContent = text;
  // Busy over a live scene dims it; boot (opaque) still covers a blank canvas.
  loading.classList.add("molvis-loading--busy");
  loading.classList.remove("molvis-loading--hidden");
}

function hideLoading(): void {
  if (!loading) return;
  loading.classList.add("molvis-loading--hidden");
}

function showLoadingError(message: string): void {
  if (!loading) return;
  loading.classList.remove("molvis-loading--hidden");
  loading.replaceChildren();
  const text = document.createElement("div");
  text.className = "molvis-loading__label";
  text.style.color = "#ff6b6b";
  text.style.maxWidth = "80%";
  text.style.textAlign = "center";
  text.textContent = message;
  loading.appendChild(text);
}

// Defer the heavy `@molcrafts/molvis-stage` chunk (WebGL engine + WASM, tens of MB) so the
// loading overlay above paints first. `bootstrapWebview` lives behind a dynamic
// import, so the entry chunk stays tiny and the browser can render the spinner
// before it starts fetching/parsing/compiling the viewer. The double rAF yields
// a frame to guarantee that first paint lands before the import kicks off.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    import("./controller")
      .then(({ bootstrapWebview }) => {
        bootstrapWebview(container, {
          onReady: hideLoading,
          // A large file parses and builds for seconds after the engine is
          // up. Reuse the same overlay so the wait reads as progress instead
          // of an empty scene.
          onBusy: (text) => (text === null ? hideLoading() : showLoading(text)),
        });
      })
      .catch((error: unknown) => {
        showLoadingError(
          "Failed to load MolVis. See developer tools for details.",
        );
        // Re-throw so the global error handler / console still records it.
        throw error;
      });
  });
});
