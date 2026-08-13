import type { Molvis } from "@molcrafts/molvis-stage";
import { Code2, Edit3, MousePointer2, Move, Ruler, Video } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  type PanelTabItem,
  PanelTabStrip,
} from "@/components/viewer/PanelTabStrip";
import { usePluginModePanels, usePluginModeTabs } from "@/plugins";
import { EditPanel } from "@/ui/modes/edit/EditPanel";
import { ManipulatePanel } from "@/ui/modes/manipulate/ManipulatePanel";
import { MeasurePanel } from "@/ui/modes/measure/MeasurePanel";
import { SelectPanel } from "@/ui/modes/select/SelectPanel";
import { ViewPanel } from "@/ui/modes/view/ViewPanel";

export interface StructureInspectorProps {
  app: Molvis | null;
  currentMode: string;
  onModeChange: (mode: string) => void;
}

const BUILTIN_MODE_ITEMS: Array<PanelTabItem & { order: number }> = [
  { value: "view", label: "View", icon: <Video />, order: 0 },
  { value: "select", label: "Select", icon: <MousePointer2 />, order: 10 },
  { value: "edit", label: "Edit", icon: <Edit3 />, order: 20 },
  { value: "measure", label: "Measure", icon: <Ruler />, order: 30 },
  { value: "manipulate", label: "Manipulate", icon: <Move />, order: 40 },
];

/**
 * Right-side tool inspector.
 *
 * Mode tabs = built-in modes **plus** plugin modes from
 * `api.modes.register(..., { tab, panel })`. Plugin modes extend the same
 * strip as View/Select/… — not a separate overlay with a Back button.
 */
export const StructureInspector: React.FC<StructureInspectorProps> = ({
  app,
  currentMode,
  onModeChange,
}) => {
  const pluginTabs = usePluginModeTabs();

  const modeItems = useMemo(() => {
    const pluginItems: Array<PanelTabItem & { order: number }> = pluginTabs.map(
      (tab) => ({
        value: tab.mode,
        label: tab.label,
        // A plugin may ship no icon; the code glyph marks it as external.
        icon: (tab.icon as React.ReactNode | undefined) ?? <Code2 />,
        order: tab.order ?? 100,
      }),
    );
    return [...BUILTIN_MODE_ITEMS, ...pluginItems].sort(
      (a, b) => a.order - b.order,
    );
  }, [pluginTabs]);

  // Controlled value must match a trigger; fall back if mode unregistered.
  const tabValue = useMemo(() => {
    if (modeItems.some((m) => m.value === currentMode)) return currentMode;
    return "view";
  }, [currentMode, modeItems]);

  const handlePointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".molvis-sketch-container")) return;
    event.stopPropagation();
  };

  return (
    <section
      aria-label="Viewer tools"
      className="flex h-full min-h-0 w-full flex-col bg-background"
      onPointerDown={handlePointerDown}
    >
      <Tabs
        value={tabValue}
        onValueChange={onModeChange}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex h-7 w-full min-w-0 shrink-0 items-stretch overflow-hidden border-b border-border/60">
          <PanelTabStrip
            items={modeItems}
            label="Viewer modes"
            disabled={app === null}
          />
        </div>

        {/*
          overflow-hidden + flex column so mode bodies get a bounded height
          and can split list/properties. overflow-y-auto here broke the chain
          (children with h-full never constrained → no adaptive split).
        */}
        <TabsContent
          value="view"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <ViewPanel app={app} />
        </TabsContent>
        <TabsContent
          value="select"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <SelectPanel app={app} />
        </TabsContent>
        <TabsContent
          value="edit"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EditPanel app={app} />
          </div>
        </TabsContent>
        <TabsContent
          value="measure"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MeasurePanel app={app} />
          </div>
        </TabsContent>
        <TabsContent
          value="manipulate"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ManipulatePanel app={app} />
          </div>
        </TabsContent>

        {pluginTabs.map((tab) => (
          <TabsContent
            key={tab.mode}
            value={tab.mode}
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <PluginModePane app={app} mode={tab.mode} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
};

/** Per-plugin-mode body; keeps hooks valid under a stable component identity. */
function PluginModePane({ app, mode }: { app: Molvis | null; mode: string }) {
  const panels = usePluginModePanels(mode);

  if (panels.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No tools for this mode.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {panels.map((panel) => {
        const Panel = panel.render;
        return (
          <div
            key={panel.id}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {/* Mode tab already names the workbench — no extra section chrome. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Panel app={app} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
