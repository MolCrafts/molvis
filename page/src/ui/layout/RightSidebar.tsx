import type { Molvis } from "@molvis/core";
import { Edit3, MousePointer2, Move, Ruler, Video } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EditPanel } from "../modes/edit/EditPanel";
import { ManipulatePanel } from "../modes/manipulate/ManipulatePanel";
import { MeasurePanel } from "../modes/measure/MeasurePanel";
import { SelectPanel } from "../modes/select/SelectPanel";
import { ViewPanel } from "../modes/view/ViewPanel";

interface RightSidebarProps {
  app: Molvis | null;
  currentMode: string;
  onModeChange: (mode: string) => void;
}

/** Prevent pointer events from leaking to the BabylonJS canvas.
 *  Skip elements inside Kekule's composer — its widget/event system listens at
 *  document level, so stopping propagation here kills every button & canvas
 *  click inside the sketch editor. */
const stopPointerPropagation = (e: React.PointerEvent) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest(".kekule-container")) return;
  e.stopPropagation();
};

const MODE_ITEMS: Array<{
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "view", label: "View", icon: Video },
  { value: "select", label: "Select", icon: MousePointer2 },
  { value: "edit", label: "Edit", icon: Edit3 },
  { value: "measure", label: "Measure", icon: Ruler },
  { value: "manipulate", label: "Manip", icon: Move },
];

export const RightSidebar: React.FC<RightSidebarProps> = ({
  app,
  currentMode,
  onModeChange,
}) => {
  const renderPanel = () => {
    switch (currentMode) {
      case "view":
        return <ViewPanel app={app} />;
      case "select":
        return <SelectPanel app={app} />;
      case "edit":
        return <EditPanel app={app} />;
      case "manipulate":
        return <ManipulatePanel app={app} />;
      case "measure":
        return <MeasurePanel app={app} />;
      default:
        return (
          <div className="p-3 text-center text-muted-foreground text-xs">
            Unknown mode: {currentMode}
          </div>
        );
    }
  };

  return (
    <div
      className="h-full w-full min-h-0 bg-background flex flex-col border-l border-border/70"
      onPointerDown={stopPointerPropagation}
    >
      <div className="border-b border-border/70 px-1.5 py-1 bg-muted/15 shrink-0">
        <div className="grid grid-cols-5 gap-0.5">
          {MODE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentMode === item.value;
            return (
              <Tooltip key={item.value}>
                <TooltipTrigger asChild>
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => onModeChange(item.value)}
                    className={cn("h-7 w-full px-0", active && "font-semibold")}
                    aria-label={item.label}
                    aria-pressed={active}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">{renderPanel()}</div>
    </div>
  );
};
