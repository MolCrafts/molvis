import type { Molvis } from "@molcrafts/molvis-stage";
import { MousePointer2 } from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { useSelectedAtoms } from "@/hooks/useSelectedAtoms";

export interface AtomSelectionBadgeProps {
  app: Molvis | null;
  compact?: boolean;
}

/** Neutral, live selection summary for the viewer toolbar. */
export const AtomSelectionBadge: React.FC<AtomSelectionBadgeProps> = ({
  app,
  compact = false,
}) => {
  const selectedAtoms = useSelectedAtoms(app);
  const count = selectedAtoms.length;

  if (count === 0) return null;

  return (
    <Badge
      variant="secondary"
      role="status"
      aria-live="polite"
      aria-label={`${count} ${count === 1 ? "atom" : "atoms"} selected`}
      className="h-control-compact gap-1 px-2 font-mono text-micro font-medium tabular-nums"
    >
      <MousePointer2 className="size-3.5" aria-hidden="true" />
      <span>{count}</span>
      {!compact && <span className="font-sans">selected</span>}
    </Badge>
  );
};
