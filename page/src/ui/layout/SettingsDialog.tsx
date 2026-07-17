import type { Molvis } from "@molvis/core";
import { Settings } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BackendSection } from "./BackendSection";
import { GraphicsSection } from "./GraphicsSection";

interface SettingsDialogProps {
  app: Molvis | null;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ app }) => {
  return (
    <Dialog modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              aria-label="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Settings</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <BackendSection />
          <div className="border-t border-border/70" />
          <GraphicsSection app={app} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
