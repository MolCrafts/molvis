import { ModeType, type Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberField } from "@/components/ui/number-field";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { useSelectionSnapshot } from "@/ui/modes/select/useSelectionSnapshot";

interface ManipulatePanelProps {
  app: Molvis | null;
}

type ManipulateTool = "move" | "rotate";

interface ManipulateModeApi {
  type: ModeType.Manipulate;
  getTool: () => ManipulateTool;
  setTool: (tool: ManipulateTool) => void;
  getEulerDegrees: () => { x: number; y: number; z: number };
  setEulerDegrees: (x: number, y: number, z: number) => void;
  getCentroid: () => { x: number; y: number; z: number } | null;
}

function isManipulateMode(mode: unknown): mode is ManipulateModeApi {
  if (!mode || typeof mode !== "object") return false;
  const m = mode as Partial<ManipulateModeApi>;
  return (
    m.type === ModeType.Manipulate &&
    typeof m.getTool === "function" &&
    typeof m.setTool === "function" &&
    typeof m.getEulerDegrees === "function" &&
    typeof m.setEulerDegrees === "function"
  );
}

/**
 * Manipulate mode inspector: tool + Euler XYZ. No tutorial copy.
 */
export const ManipulatePanel: React.FC<ManipulatePanelProps> = ({ app }) => {
  const snap = useSelectionSnapshot(app);
  const [isManipulate, setIsManipulate] = useState(false);
  const [tool, setTool] = useState<ManipulateTool>("rotate");
  const [euler, setEuler] = useState({ x: 0, y: 0, z: 0 });
  const [centroid, setCentroid] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);

  const refreshFromMode = useCallback(() => {
    if (!app || !isManipulateMode(app.mode)) {
      setIsManipulate(false);
      return;
    }
    setIsManipulate(true);
    setTool(app.mode.getTool());
    setEuler(app.mode.getEulerDegrees());
    setCentroid(app.mode.getCentroid());
  }, [app]);

  useEffect(() => {
    if (!app) {
      setIsManipulate(false);
      return;
    }
    refreshFromMode();
    const onMode = () => refreshFromMode();
    app.events.on("mode-change", onMode);
    // info-text-change is emitted on tool/drag/selection updates from mode.
    app.events.on("info-text-change", onMode);
    return () => {
      app.events.off("mode-change", onMode);
      app.events.off("info-text-change", onMode);
    };
  }, [app, refreshFromMode]);

  // Selection changes also update centroid (gizmo rest).
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the intentional trigger
  useEffect(() => {
    refreshFromMode();
  }, [snap.revision, refreshFromMode]);

  const applyTool = (next: ManipulateTool) => {
    if (!app || !isManipulateMode(app.mode)) return;
    app.mode.setTool(next);
    setTool(next);
  };

  const applyEuler = (axis: "x" | "y" | "z", value: number) => {
    if (!app || !isManipulateMode(app.mode)) return;
    const next = { ...euler, [axis]: value };
    app.mode.setEulerDegrees(next.x, next.y, next.z);
    setEuler(app.mode.getEulerDegrees());
  };

  if (!app || !isManipulate) {
    return (
      <div className="flex h-full items-center justify-center px-3">
        <EmptyState density="compact" title="Inactive" />
      </div>
    );
  }

  const hasSelection = snap.atomCount > 0 || snap.bondCount > 0;
  const selectionLabel = [
    `${snap.atomCount} atom${snap.atomCount === 1 ? "" : "s"}`,
    snap.bondCount > 0
      ? `${snap.bondCount} bond${snap.bondCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Manipulate tools"
    >
      <SidebarSection title="Selection" defaultOpen>
        <ul className="m-0 list-none space-y-0 p-0 text-micro text-muted-foreground">
          <li className="flex h-control-compact items-center justify-between gap-2">
            <span>Atoms</span>
            <span className="tabular-nums text-subtle-foreground">
              {selectionLabel}
            </span>
          </li>
          {centroid ? (
            <li className="flex h-control-compact items-center justify-between gap-2">
              <span>Pivot</span>
              <span className="tabular-nums text-subtle-foreground">
                {centroid.x.toFixed(2)}, {centroid.y.toFixed(2)},{" "}
                {centroid.z.toFixed(2)}
              </span>
            </li>
          ) : null}
        </ul>
      </SidebarSection>

      <SidebarSection title="Tool" defaultOpen>
        <div className="flex gap-1">
          <ToolButton
            active={tool === "move"}
            label="Move"
            shortcut="G"
            onClick={() => applyTool("move")}
          />
          <ToolButton
            active={tool === "rotate"}
            label="Rotate"
            shortcut="R"
            onClick={() => applyTool("rotate")}
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Rotation" defaultOpen>
        {!hasSelection ? (
          <EmptyState density="compact" title="No selection" />
        ) : (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            <AxisLabel axis="X" color="text-red-500" />
            <NumberField
              value={Number(euler.x.toFixed(2))}
              step={1}
              disabled={!hasSelection}
              aria-label="Euler X degrees"
              onChange={(v) => applyEuler("x", v)}
              className="w-full max-w-[5.5rem]"
            />
            <AxisLabel axis="Y" color="text-emerald-500" />
            <NumberField
              value={Number(euler.y.toFixed(2))}
              step={1}
              disabled={!hasSelection}
              aria-label="Euler Y degrees"
              onChange={(v) => applyEuler("y", v)}
              className="w-full max-w-[5.5rem]"
            />
            <AxisLabel axis="Z" color="text-sky-500" />
            <NumberField
              value={Number(euler.z.toFixed(2))}
              step={1}
              disabled={!hasSelection}
              aria-label="Euler Z degrees"
              onChange={(v) => applyEuler("z", v)}
              className="w-full max-w-[5.5rem]"
            />
          </div>
        )}
      </SidebarSection>
    </section>
  );
};

function ToolButton({
  active,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "flex h-control-compact flex-1 items-center justify-center gap-1 rounded-md bg-primary/15 px-2 text-label font-medium text-foreground ring-1 ring-primary/40"
          : "flex h-control-compact flex-1 items-center justify-center gap-1 rounded-md bg-muted/40 px-2 text-label text-muted-foreground hover:bg-muted/70"
      }
    >
      <span>{label}</span>
      <kbd className="text-micro text-subtle-foreground">{shortcut}</kbd>
    </button>
  );
}

function AxisLabel({ axis, color }: { axis: string; color: string }) {
  return (
    <span className={`text-label font-medium tabular-nums ${color}`}>
      {axis}
    </span>
  );
}
