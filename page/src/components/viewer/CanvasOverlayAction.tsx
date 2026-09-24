import type { ReactNode } from "react";
import { ViewerIconAction } from "./ViewerIconAction";

interface CanvasOverlayActionProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/**
 * A single action floating over the 3D canvas.
 *
 * Fullscreen needs a way back to the chrome, and the geometry is deliberately
 * fixed below the stage's mode chip (`top: 0.75rem`, ~1.9rem tall) — the two
 * share the top-right corner, so this sits clear of it rather than on it.
 */
export function CanvasOverlayAction({
  icon,
  label,
  onClick,
}: CanvasOverlayActionProps) {
  return (
    <ViewerIconAction
      icon={icon}
      label={label}
      className="absolute right-2 top-12 z-20 bg-background/70 backdrop-blur-sm hover:bg-background/90"
      onClick={onClick}
    />
  );
}
