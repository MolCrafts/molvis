export { hydrateProject } from "./hydrate";
export {
  frameToPortable,
  portableToFrame,
} from "./portable_frame";
export {
  isMolvisProject,
  serializeProject,
  serializeProjectJson,
} from "./serialize";
export {
  MOLVIS_PROJECT_FORMAT,
  type MolvisProject,
  type PortableBuffer,
  type PortableFrame,
  type ProjectDataSourcePayload,
  type ProjectPipelineEntry,
  type ProjectViewState,
} from "./types";

/** Trigger a browser download of a project JSON document. */
export function downloadProjectJson(
  json: string,
  filename = "scene.molvis.json",
): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
