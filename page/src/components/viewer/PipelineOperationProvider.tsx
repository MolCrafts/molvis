import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useReportOperationStatus } from "@/hooks/useReportOperationStatus";
import {
  useViewerOperation,
  type ViewerOperationCopy,
  type ViewerOperationResult,
} from "@/hooks/useViewerOperation";

interface PipelineOperationContextValue {
  running: boolean;
  run<T>(
    task: () => T | Promise<T>,
    copy: ViewerOperationCopy,
  ): Promise<ViewerOperationResult<T>>;
}

const PipelineOperationContext =
  createContext<PipelineOperationContextValue | null>(null);

/**
 * Shared operation runner for pipeline and representation work.
 * Tips go to the bottom status bar (no floating toast cards).
 */
export function PipelineOperationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const operation = useViewerOperation();
  useReportOperationStatus(operation.feedback);

  const value = useMemo<PipelineOperationContextValue>(
    () => ({
      running: operation.running,
      run: (task, copy) =>
        operation.run(task, copy, { successDurationMs: 2400 }),
    }),
    [operation.run, operation.running],
  );

  return (
    <PipelineOperationContext.Provider value={value}>
      {children}
    </PipelineOperationContext.Provider>
  );
}

export function usePipelineOperation(): PipelineOperationContextValue {
  const context = useContext(PipelineOperationContext);
  if (!context) {
    throw new Error(
      "usePipelineOperation must be used inside PipelineOperationProvider",
    );
  }
  return context;
}
