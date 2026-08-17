import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { PipelineTab } from "./PipelineTab";

interface ViewPanelProps {
  app: Molvis | null;
}

export const ViewPanel: React.FC<ViewPanelProps> = ({ app }) => {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PipelineTab app={app} />
    </div>
  );
};
