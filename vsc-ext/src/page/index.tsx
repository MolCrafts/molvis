/**
 * Full product shell for VS Code (`MolVis: Open Page`).
 *
 * Entry only: paint the host's loading overlay, then pull the page bundle in
 * behind a dynamic import. A static import of the shell would make the tab sit
 * blank until ~10 MB of JS has crossed the host channel and parsed — on
 * Remote-SSH that is the whole "nothing happened when I clicked" window.
 */

const container = document.getElementById("root");
const loading = document.getElementById("molvis-loading");
const label = loading?.querySelector<HTMLElement>(".molvis-loading__label");

function showLoading(text: string): void {
  if (!loading) return;
  if (label) label.textContent = text;
  loading.classList.add("molvis-loading--busy");
  loading.classList.remove("molvis-loading--hidden");
}

function hideLoading(): void {
  loading?.classList.add("molvis-loading--hidden");
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

if (!container) {
  console.error("[MolVis] #root missing — Open Page webview cannot mount");
} else {
  // Two frames so the overlay is on screen before the big chunk starts
  // fetching/parsing, same as the Quick look entry.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      import(/* webpackChunkName: "page-bootstrap" */ "./bootstrap")
        .then(({ bootstrapPage }) => {
          bootstrapPage(container, {
            onReady: hideLoading,
            onBusy: (text) =>
              text === null ? hideLoading() : showLoading(text),
          });
        })
        .catch((error: unknown) => {
          showLoadingError(
            "Failed to load MolVis. See developer tools for details.",
          );
          throw error;
        });
    });
  });
}
