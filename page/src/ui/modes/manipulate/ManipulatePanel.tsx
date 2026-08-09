import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";

interface ManipulatePanelProps {
  app: Molvis | null;
}

/**
 * Manipulate mode inspector — compact status only.
 * Drag happens on the canvas; selection is made in Select first.
 */
export const ManipulatePanel: React.FC<ManipulatePanelProps> = ({
  app: _app,
}) => {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col px-2 py-2"
      aria-label="Manipulate tools"
    >
      <ul className="space-y-1 text-micro text-muted-foreground">
        <li className="flex h-control-compact items-center justify-between gap-2">
          <span>Move</span>
          <span className="text-subtle-foreground">Drag selection</span>
        </li>
        <li className="flex h-control-compact items-center justify-between gap-2">
          <span>Select</span>
          <span className="text-subtle-foreground">Select mode first</span>
        </li>
      </ul>
    </section>
  );
};
