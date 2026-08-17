import {
  type SketchExportOptions,
  SketchImageExporter,
} from "../export/sketch_image_exporter";
import { MoleculeGraph } from "../molecule_graph";
import { defaultCanvasTheme } from "../style/tokens";
import type { FragmentTemplate } from "./fragment_templates";

/** Menu thumbnails: transparent paper, token ink/selection. */
const PREVIEW_THEME = {
  ...defaultCanvasTheme(),
  background: "transparent",
} as const;

/**
 * Compact structure-diagram SVG for a fragment template (menu previews).
 * No chrome text — only the molecular graph rendered as in the sketcher.
 */
export function fragmentPreviewSvg(
  template: FragmentTemplate,
  options: Pick<
    SketchExportOptions,
    "width" | "height" | "padding" | "background"
  > = {},
): string {
  const graph = new MoleculeGraph();
  graph.loadMoleculeData(template.data);
  return new SketchImageExporter(graph, PREVIEW_THEME, true).toSvg({
    width: options.width ?? 56,
    height: options.height ?? 56,
    padding: options.padding ?? 6,
    background: options.background ?? "transparent",
  });
}
