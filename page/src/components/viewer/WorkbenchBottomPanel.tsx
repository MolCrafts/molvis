import type { Molvis } from "@molcrafts/molvis-stage";
import { X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { cn } from "@/lib/utils";
import {
  RESIZE_KEYBOARD_STEP_PX,
  RESIZE_MAX_HEIGHT_RATIO,
  RESIZE_MIN_HEIGHT_PX,
} from "@/lib/viewer-layout";
import {
  getBottomPanelOpenRequest,
  subscribeBottomPanelHost,
} from "@/plugins/contributions/bottom_panel_host";
import { usePluginBottomPanels } from "@/plugins/hooks";
import { EdgePanel } from "./EdgePanel";

const DEFAULT_HEIGHT_PX = 220;
const MIN_HEIGHT_PX = RESIZE_MIN_HEIGHT_PX;

export interface WorkbenchBottomPanelProps {
  app: Molvis | null;
  hidden?: boolean;
}

/**
 * Bottom workbench rail — product chrome over shared {@link EdgePanel}
 * (molcrafts-ui block). Pull hairline up to open; same snap/drag language as
 * left/right workbench rails.
 */
export const WorkbenchBottomPanel: React.FC<WorkbenchBottomPanelProps> = ({
  app,
  hidden = false,
}) => {
  const pluginPanels = usePluginBottomPanels();
  const hasProvider = pluginPanels.length > 0;

  const [open, setOpen] = useState(false);
  const [heightPx, setHeightPx] = useState(DEFAULT_HEIGHT_PX);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [lastHandledSeq, setLastHandledSeq] = useState(0);

  useEffect(() => {
    if (!hasProvider) {
      setActiveId(undefined);
      setOpen(false);
      return;
    }
    setActiveId((current) => {
      if (current && pluginPanels.some((t) => t.id === current)) return current;
      return pluginPanels[0]?.id;
    });
    if (pluginPanels.some((p) => p.defaultOpen)) {
      setOpen(true);
      setHeightPx((h) => (h < MIN_HEIGHT_PX ? DEFAULT_HEIGHT_PX : h));
    }
  }, [hasProvider, pluginPanels]);

  useEffect(() => {
    const apply = () => {
      const req = getBottomPanelOpenRequest();
      if (!req || req.seq === lastHandledSeq) return;
      const match = pluginPanels.find(
        (p) =>
          p.id === req.id ||
          p.id.endsWith(`.${req.id}`) ||
          p.id.endsWith(req.id),
      );
      if (!match) return;
      setLastHandledSeq(req.seq);
      setActiveId(match.id);
      setHeightPx((h) => (h < MIN_HEIGHT_PX ? DEFAULT_HEIGHT_PX : h));
      setOpen(true);
    };
    apply();
    return subscribeBottomPanelHost(apply);
  }, [pluginPanels, lastHandledSeq]);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  if (hidden || !hasProvider) return null;

  const header = (
    <div className="flex h-6 w-full min-w-0 items-center gap-0.5 px-1">
      <div
        role="tablist"
        aria-label="Bottom panels"
        className="flex h-full min-w-0 flex-1 items-stretch justify-start"
      >
        {pluginPanels.map((p) => {
          const selected = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                "relative h-full shrink-0 px-2 text-micro font-medium",
                "border-0 bg-transparent shadow-none outline-none",
                "text-muted-foreground hover:text-foreground",
                "focus-visible:ring-1 focus-visible:ring-ring",
                selected && "text-accent",
              )}
              onClick={() => setActiveId(p.id)}
            >
              {p.title}
              {selected ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1.5 bottom-0 h-px bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <ViewerIconAction
        icon={<X />}
        label="Close panel"
        tooltipSide="top"
        onClick={closePanel}
        className="size-6 shrink-0"
      />
    </div>
  );

  return (
    <EdgePanel
      side="bottom"
      open={open}
      size={heightPx}
      minSize={MIN_HEIGHT_PX}
      maxSizeRatio={RESIZE_MAX_HEIGHT_RATIO}
      defaultSize={DEFAULT_HEIGHT_PX}
      keyboardStepPx={RESIZE_KEYBOARD_STEP_PX}
      onOpenChange={setOpen}
      onSizeChange={setHeightPx}
      header={header}
      showHandleWhenClosed
      openLabel="Open bottom panel"
      resizeLabel="Resize bottom panel"
      handleClassName={cn(
        "workbench-split workbench-split-h workbench-split-interactive",
        !open && "h-1 border-0",
      )}
      className="bg-background"
    >
      {pluginPanels.map((p) => {
        const Body = p.render;
        const active = p.id === activeId;
        return (
          <div
            key={p.id}
            hidden={!active}
            className="h-full min-h-0 overflow-hidden bg-background"
          >
            {active && open ? (
              <ErrorBoundary name={`plugin panel ${p.id}`}>
                <Body app={app} />
              </ErrorBoundary>
            ) : null}
          </div>
        );
      })}
    </EdgePanel>
  );
};
