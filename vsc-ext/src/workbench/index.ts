/**
 * Workbench L0 — tab chrome (Stage | Sketch) + loading, then L1 bootstrap.
 * Entry stays free of stage/sketch/page static imports.
 */

export {};

const root = document.getElementById("molvis-workbench");
if (!root) {
  throw new Error("Missing #molvis-workbench");
}

const loading = document.getElementById("molvis-loading");

function hideLoading(): void {
  if (!loading) return;
  loading.classList.add("molvis-loading--hidden");
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

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    import("./bootstrap")
      .then(({ bootstrapWorkbench }) => {
        void bootstrapWorkbench(root, { onReady: hideLoading });
      })
      .catch((error: unknown) => {
        showLoadingError(
          "Failed to load MolVis Workbench. See developer tools for details.",
        );
        throw error;
      });
  });
});
