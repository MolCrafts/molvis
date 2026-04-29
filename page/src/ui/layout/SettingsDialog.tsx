import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Molvis } from "@molvis/core";
import { Settings } from "lucide-react";
import type React from "react";
import { BackendSection } from "./BackendSection";
import { GraphicsSection } from "./GraphicsSection";

interface SettingsDialogProps {
  app: Molvis | null;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ app }) => {
  return (
    <Dialog modal={false}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Settings">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <BackendSection />
          <div className="border-t" />
          <GraphicsSection app={app} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
