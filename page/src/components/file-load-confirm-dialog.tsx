import type { Molvis } from "@molcrafts/molvis-stage";

/** True when the pipeline already holds a non-empty data source. */
export function sceneHasLoadedData(app: Molvis | null): boolean {
  if (!app) return false;
  return app.modifierPipeline
    .sources()
    .some((source) => source.sourceType !== "empty");
}
