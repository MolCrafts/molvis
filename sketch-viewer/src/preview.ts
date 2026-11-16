/**
 * The read-only sketch board's header: the MolCrafts preview header
 * (`@molcrafts/ui/preview`, React in a shadow root), the same one MolPlot
 * charts and MolVis viewers show. It goes in the composer's `previewSlot`;
 * a notice for loading, empty and error states goes over the board.
 *
 * The sketch engine stays React-free: only this host package loads the UI.
 */
import type { SketchComposer } from "@molcrafts/molvis-sketch";
import type {
  MountedPreviewHeader,
  MountedPreviewNotice,
  PreviewAction,
  PreviewState,
} from "@molcrafts/ui/preview";

export interface SketchPreview {
  setTitle(title: string | undefined): void;
  setState(state: PreviewState): void;
  destroy(): void;
}

function loadUi() {
  return Promise.all([
    import("@molcrafts/ui/preview"),
    import("@molcrafts/ui/styles.css?raw"),
  ]).then(([mount, css]) => ({ mount, stylesheet: css.default }));
}

/**
 * Mount the header for a read-only composer. Title and state may be set
 * before the UI has loaded; they apply when it mounts. `null` for an editor.
 */
export function createSketchPreview(
  composer: SketchComposer,
  init: { title?: string; state?: PreviewState; theme?: "light" | "dark" } = {},
): SketchPreview | null {
  const slot = composer.previewSlot;
  if (!slot) return null;
  let title = init.title;
  let state: PreviewState = init.state ?? { kind: "ready" };
  let header: MountedPreviewHeader | null = null;
  let notice: MountedPreviewNotice | null = null;
  let fileName: (
    title: string | undefined,
    ext: string,
    fallback?: string,
  ) => string = (_t, ext) => `sketch.${ext}`;
  let destroyed = false;

  const noticeHost = slot.ownerDocument.createElement("div");
  noticeHost.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:1";
  composer.stageElement.append(noticeHost);

  const fail = (what: string, error: unknown) => {
    state = {
      kind: "error",
      message: `${what}: ${error instanceof Error ? error.message : String(error)}`,
    };
    refresh();
  };

  const actions = (): PreviewAction[] => {
    const empty = composer.counts().atoms === 0;
    const doc = slot.ownerDocument;
    const full = doc.fullscreenElement === composer.root;
    const list: PreviewAction[] = [
      {
        kind: "button",
        id: "fit",
        label: "Reset view",
        icon: "reset-view",
        group: "view",
        shortcut: "f",
        disabled: empty,
        run: () => composer.board.fitToView(),
      },
      {
        kind: "button",
        id: "zoom-in",
        label: "Zoom in",
        icon: "zoom-in",
        group: "view",
        shortcut: "+",
        disabled: empty,
        run: () => composer.board.zoomBy(1.25),
      },
      {
        kind: "button",
        id: "zoom-out",
        label: "Zoom out",
        icon: "zoom-out",
        group: "view",
        shortcut: "-",
        disabled: empty,
        run: () => composer.board.zoomBy(0.8),
      },
    ];
    if (doc.fullscreenEnabled) {
      list.push({
        kind: "toggle",
        id: "fullscreen",
        label: full ? "Exit fullscreen" : "Fullscreen",
        icon: full ? "exit-fullscreen" : "fullscreen",
        group: "view",
        pressed: full,
        onToggle: (next) =>
          void (
            next ? composer.root.requestFullscreen() : doc.exitFullscreen()
          ).catch((error: unknown) =>
            fail("Fullscreen is not allowed here", error),
          ),
      });
    }
    list.push({
      kind: "menu",
      id: "export",
      label: "Export",
      icon: "export",
      group: "export",
      disabled: empty,
      items: (["png", "svg"] as const).map((format) => ({
        id: format,
        label: format === "png" ? "PNG image" : "SVG vector",
        run: () =>
          void composer
            .exportImage(format, fileName(title, format, "sketch"))
            .catch((error: unknown) => fail("Export failed", error)),
      })),
    });
    return list;
  };

  const shown = (): PreviewState =>
    state.kind === "ready" && composer.counts().atoms === 0
      ? { kind: "empty", message: "No molecule on the board." }
      : state;

  function refresh(): void {
    const { atoms, bonds } = composer.counts();
    const now = shown();
    header?.update({
      title,
      state: now,
      meta: atoms > 0 ? `${atoms} atoms · ${bonds} bonds` : undefined,
      actions: actions(),
    });
    notice?.update(now);
  }

  const unsubscribe = composer.board.subscribe(() => refresh());
  const onFullscreen = () => refresh();
  slot.ownerDocument.addEventListener("fullscreenchange", onFullscreen);

  loadUi()
    .then(({ mount, stylesheet }) => {
      if (destroyed) return;
      fileName = mount.previewFileName;
      const options = { stylesheet, theme: init.theme };
      header = mount.mountPreviewHeader(
        slot,
        {
          mode: "readonly",
          product: "Sketch",
          title,
          state: shown(),
          actions: actions(),
        },
        options,
      );
      notice = mount.mountPreviewNotice(noticeHost, shown(), options);
      refresh();
    })
    .catch((error: unknown) => {
      slot.textContent = `Could not show the header: ${error instanceof Error ? error.message : String(error)}`;
    });

  return {
    setTitle(next) {
      title = next;
      refresh();
    },
    setState(next) {
      state = next;
      refresh();
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      slot.ownerDocument.removeEventListener("fullscreenchange", onFullscreen);
      header?.destroy();
      notice?.destroy();
      noticeHost.remove();
    },
  };
}
