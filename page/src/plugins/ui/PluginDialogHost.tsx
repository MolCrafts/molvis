import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { closePluginDialog } from "@/plugins/contributions/dialog_host";
import { useOpenPluginDialogId, usePluginDialogs } from "@/plugins/hooks";
import type { PluginDialogSize } from "@/plugins/types";

const SIZE_CLASS: Record<PluginDialogSize, string> = {
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl max-h-[90vh]",
  full: "sm:max-w-[min(96vw,1400px)] max-h-[94vh] h-[90vh]",
};

export interface PluginDialogHostProps {
  app: Molvis | null;
}

/**
 * Renders the currently open plugin dialog contribution.
 * Plugins never mount their own overlay — they register content only.
 */
export const PluginDialogHost: React.FC<PluginDialogHostProps> = ({ app }) => {
  const openId = useOpenPluginDialogId();
  const dialogs = usePluginDialogs();
  const active = openId ? dialogs.find((d) => d.id === openId) : undefined;
  const open = Boolean(active);

  const Body = active?.render;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closePluginDialog();
      }}
    >
      <DialogContent
        showCloseButton
        className={cn(
          "flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0",
          active ? SIZE_CLASS[active.size ?? "lg"] : SIZE_CLASS.lg,
        )}
        aria-describedby={undefined}
      >
        {active && Body ? (
          <>
            <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-3">
              <DialogTitle className="text-base font-semibold tracking-tight">
                {active.title}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto">
              <Body app={app} close={closePluginDialog} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
