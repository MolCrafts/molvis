import type { Molvis } from "@molcrafts/molvis-stage";
import { useCallback } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";

interface PipelineCopy {
  running: string;
  success: string;
  error: string;
}

/** Apply one modifier change through the shared pipeline status surface. */
export function useApplyPipelineOperation(
  app: Molvis | null,
  onUpdate: () => void,
  copy: PipelineCopy,
) {
  const { run, running } = usePipelineOperation();

  const applyPipeline = useCallback(
    (options?: Parameters<Molvis["applyPipeline"]>[0]) => {
      onUpdate();
      if (!app) return;
      void run(() => app.applyPipeline(options), copy);
    },
    [app, copy, onUpdate, run],
  );

  return {
    applyPipeline,
    pipelineRunning: running,
  };
}
