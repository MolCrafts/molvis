import type { AnalysisParamValues, Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getPluginAnalysisSpec,
  pluginSpecToDefinition,
} from "@/plugins/analysis_catalog";
import type { PluginAnalysisResult } from "@/plugins/types";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisParamsForm } from "./AnalysisParamsForm";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ResultSection } from "./ResultSection";
import { ResultView } from "./ResultView";

interface PluginAnalysisPanelProps {
  app: Molvis | null;
  analysisId: string;
}

interface RunState {
  status: "idle" | "running" | "done" | "error";
  result?: PluginAnalysisResult;
  message?: string;
}

/**
 * Runs a page-side plugin analysis registered via `api.analysis.register`.
 * Params use the same form as molrs generic panels; results use `resultKind`
 * or a custom `renderResult` from the plugin.
 *
 * No frame scope: `spec.run` receives `{ app, params }` only, so neither a
 * scope control nor a scope summary would describe what actually runs.
 */
export const PluginAnalysisPanel: React.FC<PluginAnalysisPanelProps> = ({
  app,
  analysisId,
}) => {
  const spec = getPluginAnalysisSpec(analysisId);
  const definition = useMemo(
    () => (spec ? pluginSpecToDefinition(spec) : null),
    [spec],
  );

  const [params, setParams] = useState<AnalysisParamValues>(() => {
    if (!definition) return {};
    const init: AnalysisParamValues = {};
    for (const p of definition.params) {
      init[p.key] = p.default;
    }
    return init;
  });
  const [run, setRun] = useState<RunState>({ status: "idle" });

  if (!spec || !definition) {
    return (
      <EmptyState
        density="compact"
        title="Plugin compute unavailable"
        description={`No active plugin registered compute '${analysisId}'.`}
      />
    );
  }

  const onRun = async () => {
    if (!app) return;
    setRun({ status: "running" });
    try {
      const result = await spec.run({ app, params });
      setRun({ status: "done", result });
    } catch (err) {
      setRun({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const CustomResult = spec.renderResult;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={() => void onRun()}
          disabled={!app}
          running={run.status === "running"}
          label={`Run ${spec.label}`}
          hint={
            run.status === "error" ? (
              <span className="text-destructive">{run.message}</span>
            ) : undefined
          }
        />
      }
    >
      {definition.params.length > 0 && (
        <div className="flex flex-col gap-2 p-2">
          <AnalysisParamsForm
            params={definition.params}
            values={params}
            onChange={setParams}
            disabled={run.status === "running"}
          />
        </div>
      )}

      {run.status === "error" && (
        <AnalysisAlert tone="error">{run.message}</AnalysisAlert>
      )}

      {run.status === "done" && run.result && (
        <ResultSection>
          {CustomResult ? (
            <CustomResult result={run.result} />
          ) : (
            <ResultView
              resultKind={definition.resultKind}
              payload={
                typeof run.result.data === "object" && run.result.data !== null
                  ? (run.result.data as Record<string, unknown>)
                  : { value: run.result.data }
              }
              label={spec.label}
            />
          )}
        </ResultSection>
      )}
    </AnalysisPanelShell>
  );
};
