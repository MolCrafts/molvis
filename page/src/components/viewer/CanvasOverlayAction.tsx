import { IconAction } from "@molcrafts/ui";
import type { ReactNode } from "react";

interface CanvasOverlayActionProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/**
 * A single action floating over the 3D canvas.
 *
 * Two surfaces need one: fullscreen needs a way back to the chrome, and the
 * canvas surface needs a way to ask the host for it. The geometry is shared
 * and deliberately fixed — there is no second position to parameterise.
 */
export function CanvasOverlayAction({
  icon,
  label,
  onClick,
}: CanvasOverlayActionProps) {
  return (
    <IconAction
      icon={icon}
      label={label}
      className="absolute right-2 top-2 z-20 bg-background hover:bg-interactive"
      onClick={onClick}
    />
  );
}
