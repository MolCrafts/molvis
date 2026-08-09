import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";

interface MeasurePanelProps {
  app: Molvis | null;
}

/**
 * Measure mode inspector — short usage bullets only.
 * Gesture lives on the canvas; this rail explains how to drive it.
 */
export const MeasurePanel: React.FC<MeasurePanelProps> = ({ app: _app }) => {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col px-2 py-2"
      aria-label="How to measure"
    >
      <ul className="list-disc space-y-1.5 pl-4 text-micro leading-snug text-muted-foreground marker:text-subtle-foreground">
        <li>Click atoms in order on the canvas</li>
        <li>
          <span className="text-foreground">2 atoms</span> — distance
        </li>
        <li>
          <span className="text-foreground">3 atoms</span> — angle
        </li>
        <li>
          <span className="text-foreground">4 atoms</span> — dihedral
        </li>
        <li>Click empty space to clear all measurements</li>
        <li>Right-click for units, precision, and Clear All</li>
      </ul>
    </section>
  );
};
