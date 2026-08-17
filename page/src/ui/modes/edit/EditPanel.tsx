import {
  type Frame,
  generate3D,
  ModeType,
  type Molvis,
  Perceive,
  parseSMILES,
} from "@molcrafts/molvis-stage";
import { Loader2, Wand2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmptyState } from "@/components/ui/empty-state";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { useReportOperationStatus } from "@/hooks/useReportOperationStatus";
import { useViewerOperation } from "@/hooks/useViewerOperation";
import { cn } from "@/lib/utils";
import { usePluginModePanels } from "@/plugins";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { DownloadStructureSection } from "./DownloadStructureSection";
import { MolvisSketch, type MolvisSketchRef } from "./MolvisSketch";
import { SmilesInput } from "./SmilesInput";
import { ToolsTab } from "./ToolsTab";

interface EditPanelProps {
  app: Molvis | null;
}

type EditSection = string;

interface EditModeWithPending {
  type: ModeType.Edit;
  pendingMolecule: unknown;
}

function isEditMode(mode: unknown): mode is EditModeWithPending {
  if (!mode || typeof mode !== "object") return false;
  return (mode as { type?: unknown }).type === ModeType.Edit;
}

function placeFrame(app: Molvis, frame3d: Frame) {
  const mode = app.mode;
  if (isEditMode(mode)) {
    mode.pendingMolecule = frame3d;
  } else {
    frame3d.free();
    throw new Error("Switch to Edit mode first");
  }
}

function generateAndPlace(app: Molvis, frame2d: Frame) {
  let frame3d: Frame;
  try {
    frame3d = generate3D(frame2d, "fast");
  } finally {
    frame2d.free();
  }
  // molrs Perceive: fill localized bond_number on aromatic bonds before stamp.
  // PlaceMoleculeCommand also runs this; doing it here keeps the pending
  // template inspectable / re-stampable with correct columns.
  const withKekule = new Perceive().findKekuleOrders(frame3d);
  frame3d.free();
  placeFrame(app, withKekule);
}

const GENERATE_COPY = {
  running: "Generating a 3D structure…",
  success: "3D structure ready",
  successDetail: "Click the 3D canvas to place copies (Esc to cancel).",
  error: "Could not generate the 3D structure",
};

/**
 * Edit mode inspector: exclusive accordion of native and plugin sections.
 * Only one section is open at a time. Sections use flat divider chrome
 * (SidebarSection default border-b) — no nested cards.
 */
export const EditPanel: React.FC<EditPanelProps> = ({ app }) => {
  const sketchRef = useRef<MolvisSketchRef>(null);
  const pluginPanels = usePluginModePanels("edit");
  const [isEdit, setIsEdit] = useState(false);
  /** Exclusive accordion: at most one open; null = all collapsed. */
  const [openSection, setOpenSection] = useState<EditSection | null>("draw");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const {
    feedback,
    running: generating,
    run: runGeneration,
    reset: resetGeneration,
  } = useViewerOperation();
  useReportOperationStatus(feedback);

  useEffect(() => {
    if (!app) {
      setIsEdit(false);
      return;
    }
    const update = () => setIsEdit(isEditMode(app.mode));
    update();
    app.events.on("mode-change", update);
    return () => {
      app.events.off("mode-change", update);
    };
  }, [app]);

  const sectionProps = (id: EditSection) => ({
    open: openSection === id,
    keepMounted: true as const,
    onOpenChange: (next: boolean) => {
      setOpenSection(next ? id : null);
    },
  });

  const handleSmiles = useCallback(
    (smiles: string) => {
      if (!app) return;
      void runGeneration(() => {
        const ir = parseSMILES(smiles);
        let frame2d: Frame;
        try {
          frame2d = ir.toFrame();
        } finally {
          ir.free();
        }
        generateAndPlace(app, frame2d);
      }, GENERATE_COPY);
    },
    [app, runGeneration],
  );

  const handleDrawing = useCallback(() => {
    if (!app) return;
    void runGeneration(() => {
      const frame2d = sketchRef.current?.toFrame();
      if (!frame2d) {
        throw new Error("Draw a molecule first");
      }
      generateAndPlace(app, frame2d);
    }, GENERATE_COPY);
  }, [app, runGeneration]);

  const handleDownloadBusyChange = useCallback(
    (next: boolean) => {
      setDownloadBusy(next);
      if (next) resetGeneration();
    },
    [resetGeneration],
  );

  if (!app || !isEdit) {
    return (
      <div className="flex h-full items-center justify-center px-3">
        <EmptyState density="compact" title="Edit inactive" />
      </div>
    );
  }

  const busy = generating || downloadBusy;
  const sketchOpen = openSection === "sketch";

  return (
    <fieldset
      disabled={busy}
      aria-busy={busy}
      aria-label="Edit tools"
      className="m-0 flex h-full min-h-0 min-w-0 flex-col border-0 p-0 pointer-events-auto"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SidebarSection title="Draw" {...sectionProps("draw")}>
          <ToolsTab app={app} />
        </SidebarSection>

        <SidebarSection title="SMILES" {...sectionProps("smiles")}>
          <SmilesInput onParsed={handleSmiles} disabled={busy} />
        </SidebarSection>

        <DownloadStructureSection
          {...sectionProps("download")}
          disabled={generating}
          onBusyChange={handleDownloadBusyChange}
          onFrameFetched={(frame) => {
            placeFrame(app, frame);
          }}
        />

        <SidebarSection
          title="Sketch"
          {...sectionProps("sketch")}
          className={cn(
            "border-b border-border/70",
            sketchOpen && "flex min-h-0 flex-1 flex-col",
          )}
          contentClassName={
            sketchOpen ? "flex min-h-0 flex-1 flex-col !space-y-0" : undefined
          }
        >
          <MolvisSketch
            ref={sketchRef}
            disabled={busy}
            minHeight={sketchOpen ? 260 : 0}
            extraActions={
              <ViewerIconAction
                label="Generate 3D from sketch & place"
                icon={busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
                disabled={busy}
                onClick={handleDrawing}
                onPointerDown={(e) => e.stopPropagation()}
              />
            }
          />
        </SidebarSection>

        {pluginPanels.map((panel) => {
          const Panel = panel.render;
          return (
            <SidebarSection
              key={panel.id}
              title={panel.title ?? "Plugin"}
              {...sectionProps(panel.id)}
            >
              <ErrorBoundary name={`plugin panel ${panel.id}`}>
                <Panel app={app} />
              </ErrorBoundary>
            </SidebarSection>
          );
        })}
      </div>
    </fieldset>
  );
};
