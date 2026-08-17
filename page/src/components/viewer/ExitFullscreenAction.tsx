import { Minimize } from "lucide-react";
import { ViewerIconAction } from "./ViewerIconAction";

interface ExitFullscreenActionProps {
  onExit: () => void;
}

/** Restores viewer chrome from the canvas-only fullscreen surface. */
export function ExitFullscreenAction({ onExit }: ExitFullscreenActionProps) {
  return (
    <ViewerIconAction
      icon={<Minimize />}
      label="Exit fullscreen"
      className="absolute right-2 top-2 z-20 bg-background/70 backdrop-blur-sm hover:bg-background/90"
      onClick={onExit}
    />
  );
}
