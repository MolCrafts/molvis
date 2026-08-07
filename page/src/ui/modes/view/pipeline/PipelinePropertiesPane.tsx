import type { Molvis, PipelineEntry } from "@molcrafts/molvis-stage";
import type React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RESIZE_KEYBOARD_STEP_PX } from "@/lib/viewer-layout";
import { ModifierProperties } from "../ModifierProperties";

interface PipelinePropertiesPaneProps {
  app: Molvis | null;
  selectedModifier: PipelineEntry | undefined;
  allEntries: readonly PipelineEntry[];
  propertiesHeight: number;
  /** Receives the body element so a drag can paint its height directly. */
  onPropertiesEl: (el: HTMLElement | null) => void;
  propertiesMaxHeight: number;
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent) => void;
  onResizeBy: (delta: number) => void;
  onUpdate: () => void;
}

export function PipelinePropertiesPane({
  app,
  selectedModifier,
  allEntries,
  propertiesHeight,
  onPropertiesEl,
  propertiesMaxHeight,
  isResizing,
  onResizeStart,
  onResizeBy,
  onUpdate,
}: PipelinePropertiesPaneProps) {
  const hasSelection = selectedModifier !== undefined;

  return (
    <>
      <hr
        aria-label="Resize modifier properties"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(propertiesMaxHeight)}
        aria-valuenow={Math.round(propertiesHeight)}
        tabIndex={hasSelection ? 0 : -1}
        data-resizing={isResizing ? "true" : undefined}
        className={
          hasSelection
            ? "workbench-split workbench-split-h workbench-split-interactive z-10 touch-none border-0"
            : "workbench-split workbench-split-h z-10 border-0"
        }
        onPointerDown={hasSelection ? onResizeStart : undefined}
        onKeyDown={
          hasSelection
            ? (event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onResizeBy(RESIZE_KEYBOARD_STEP_PX);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onResizeBy(-RESIZE_KEYBOARD_STEP_PX);
                }
              }
            : undefined
        }
      />

      <div
        ref={onPropertiesEl}
        style={{ height: propertiesHeight }}
        className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-background"
      >
        {selectedModifier ? (
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <ModifierProperties
              modifier={selectedModifier}
              allEntries={allEntries}
              app={app}
              onUpdate={onUpdate}
            />
          </ScrollArea>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center px-3">
            <p className="max-w-full truncate text-center text-micro text-muted-foreground/80">
              Select an item
            </p>
          </div>
        )}
      </div>
    </>
  );
}
