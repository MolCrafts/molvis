const container = document.getElementById("molvis-container");
if (!container) {
  throw new Error("Missing container");
}

const loading = document.getElementById("molvis-loading");

function hideLoading(): void {
  if (!loading) return;
  loading.classList.add("molvis-loading--hidden");
  // Remove after the fade-out so it never intercepts pointer events.
  window.setTimeout(() => loading.remove(), 400);
}

function showLoadingError(message: string): void {
  if (!loading) return;
  loading.classList.remove("molvis-loading--hidden");
  loading.replaceChildren();
  const label = document.createElement("div");
  label.className = "molvis-loading__label";
  label.style.color = "#ff6b6b";
  label.style.maxWidth = "80%";
  label.style.textAlign = "center";
  label.textContent = message;
  loading.appendChild(label);
}

// Defer the heavy `@molvis/core` chunk (WebGL engine + WASM, tens of MB) so the
// loading overlay above paints first. `bootstrapWebview` lives behind a dynamic
// import, so the entry chunk stays tiny and the browser can render the spinner
// before it starts fetching/parsing/compiling the viewer. The double rAF yields
// a frame to guarantee that first paint lands before the import kicks off.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    import("./controller")
      .then(({ bootstrapWebview }) => {
        bootstrapWebview(container, { onReady: hideLoading });
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
