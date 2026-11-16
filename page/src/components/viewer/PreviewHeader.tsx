import {
  type Molvis,
  REPRESENTATIONS,
  type RepresentationId,
} from "@molcrafts/molvis-stage";
import {
  PreviewHeader as MolcraftsPreviewHeader,
  PreviewNotice as MolcraftsPreviewNotice,
  type PreviewAction,
  type PreviewState,
  previewFileName,
} from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { useBackendConnection } from "@/hooks/useBackendConnection";
import { useMountOpts } from "@/lib/mount-opts";
import { reportStatus } from "@/lib/status-report";

const ORTHOGRAPHIC = 1;
const ZOOM_STEP = 0.8;

interface Counts {
  atoms: number;
  bonds: number;
}

/**
 * What the read-only page is doing: connecting, waiting for the structure,
 * refused because another window holds this preview, or ready.
 */
export function usePreviewState(app: Molvis | null): {
  state: PreviewState;
  counts: Counts | null;
} {
  const { status, error, wsUrl } = useBackendConnection();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    if (!app) return;
    // Count what the scene draws: the event's frame can be freed by the
    // time a listener runs, and the system frame is empty when the
    // structure arrives through a data source.
    return app.events.on("frame-rendered", () => {
      const meta = app.world.sceneIndex.metaRegistry;
      let atoms = 0;
      for (const _ of meta.atoms.getAllIds()) atoms += 1;
      let bonds = 0;
      for (const _ of meta.bonds.getAllIds()) bonds += 1;
      setCounts({ atoms, bonds });
    });
  }, [app]);

  if (status === "error") {
    const taken = error !== null && /already bound|1013/.test(error);
    return {
      counts,
      state: {
        kind: "error",
        message: taken
          ? "This preview is open in another window. Close it there, then reload this page."
          : `Lost the connection to MolVis${error ? `: ${error}` : "."}`,
      },
    };
  }
  if (counts !== null) return { counts, state: { kind: "ready" } };
  if (!wsUrl)
    return {
      counts,
      state: { kind: "empty", message: "No structure to show." },
    };
  return {
    counts,
    state: {
      kind: "loading",
      message:
        status === "connected"
          ? "Waiting for the structure…"
          : "Connecting to MolVis…",
    },
  };
}

function setOrthographic(app: Molvis, on: boolean): void {
  const camera = app.world.camera;
  app.world.viewportSettings.setPerspective(!on);
  if (!on) {
    camera.orthoTop = null;
    camera.orthoBottom = null;
    camera.orthoLeft = null;
    camera.orthoRight = null;
    return;
  }
  // Same framing as the view panel: the ortho box matches what perspective showed at the target.
  const height = 2 * camera.radius * Math.tan(camera.fov / 2);
  const width = height * app.world.scene.getEngine().getAspectRatio(camera);
  camera.orthoTop = height / 2;
  camera.orthoBottom = -height / 2;
  camera.orthoLeft = -width / 2;
  camera.orthoRight = width / 2;
  camera.mode = ORTHOGRAPHIC;
}

async function downloadView(
  app: Molvis,
  title: string | undefined,
  transparent: boolean,
): Promise<void> {
  const url = await app.screenshot({
    width: app.canvas.width,
    height: app.canvas.height,
    format: "png",
    transparentBackground: transparent,
    autoCrop: false,
  });
  const link = document.createElement("a");
  link.href = url;
  link.download = previewFileName(title, "png", "molvis");
  link.click();
}

function fail(what: string, error: unknown): void {
  reportStatus(
    `${what}: ${error instanceof Error ? error.message : String(error)}`,
    "error",
  );
}

/**
 * The read-only header (`surface=preview`): the MolCrafts preview header
 * from `@molcrafts/ui` (React), the one MolPlot charts and sketch
 * boards show. Everything here changes the view, never the scene.
 */
export const PreviewHeader: React.FC<{ app: Molvis | null }> = ({ app }) => {
  const opts = useMountOpts();
  const title = opts.title ?? opts.session;
  const { state, counts } = usePreviewState(app);
  const [ortho, setOrtho] = useState(false);
  const [spin, setSpin] = useState(false);
  const [full, setFull] = useState(false);
  const [representation, setRepresentation] =
    useState<RepresentationId>("ball-and-stick");

  useEffect(() => {
    if (!app) return;
    return app.events.on("representation-change", (style) =>
      setRepresentation(style.id),
    );
  }, [app]);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const ready = app !== null && state.kind === "ready";
  const actions: PreviewAction[] = [
    {
      kind: "button",
      id: "fit",
      label: "Reset view",
      icon: "reset-view",
      group: "view",
      shortcut: "f",
      disabled: !ready,
      run: () => app?.world.fit(),
    },
    {
      kind: "button",
      id: "zoom-in",
      label: "Zoom in",
      icon: "zoom-in",
      group: "view",
      shortcut: "+",
      disabled: !ready,
      run: () => {
        if (app) app.world.camera.radius *= ZOOM_STEP;
      },
    },
    {
      kind: "button",
      id: "zoom-out",
      label: "Zoom out",
      icon: "zoom-out",
      group: "view",
      shortcut: "-",
      disabled: !ready,
      run: () => {
        if (app) app.world.camera.radius /= ZOOM_STEP;
      },
    },
    ...(document.fullscreenEnabled
      ? [
          {
            kind: "toggle" as const,
            id: "fullscreen",
            label: full ? "Exit fullscreen" : "Fullscreen",
            icon: full ? ("exit-fullscreen" as const) : ("fullscreen" as const),
            group: "view" as const,
            pressed: full,
            onToggle: (next: boolean) =>
              void (
                next
                  ? document.documentElement.requestFullscreen()
                  : document.exitFullscreen()
              ).catch((error: unknown) =>
                fail("Fullscreen is not allowed here", error),
              ),
          },
        ]
      : []),
    {
      kind: "toggle",
      id: "ortho",
      label: "Orthographic projection",
      icon: "projection",
      group: "inspect",
      pressed: ortho,
      disabled: !ready,
      onToggle: (next) => {
        if (!app) return;
        setOrthographic(app, next);
        setOrtho(next);
      },
    },
    {
      kind: "toggle",
      id: "spin",
      label: "Spin",
      icon: "spin",
      group: "inspect",
      pressed: spin,
      disabled: !ready,
      onToggle: (next) => {
        if (!app) return;
        app.world.camera.useAutoRotationBehavior = next;
        setSpin(next);
      },
    },
    {
      kind: "menu",
      id: "style",
      label: "Style",
      icon: "style",
      group: "inspect",
      disabled: !ready,
      items: REPRESENTATIONS.map((style) => ({
        id: style.id,
        label: style.name,
        checked: style.id === representation,
        run: () =>
          void app
            ?.setRepresentation(style.id)
            .catch((error: unknown) =>
              fail("Could not change the style", error),
            ),
      })),
    },
    {
      kind: "menu",
      id: "export",
      label: "Export",
      icon: "export",
      group: "export",
      disabled: !ready,
      items: [
        {
          id: "png",
          label: "PNG image",
          run: () => {
            if (app)
              downloadView(app, title, false).catch((error: unknown) =>
                fail("Could not save the view", error),
              );
          },
        },
        {
          id: "png-clear",
          label: "PNG, transparent background",
          run: () => {
            if (app)
              downloadView(app, title, true).catch((error: unknown) =>
                fail("Could not save the view", error),
              );
          },
        },
      ],
    },
  ];
  const meta = counts
    ? `${counts.atoms} atoms · ${counts.bonds} bonds`
    : undefined;

  return (
    <MolcraftsPreviewHeader
      mode="readonly"
      product="MolVis"
      title={title}
      meta={meta}
      state={state}
      actions={actions}
    />
  );
};

/** The same state, centered over the canvas while there is nothing to look at. */
export const PreviewNotice: React.FC<{ app: Molvis | null }> = ({ app }) => {
  const { state } = usePreviewState(app);
  return <MolcraftsPreviewNotice state={state} />;
};
