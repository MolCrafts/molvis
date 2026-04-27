import type { Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * DataSourceModifier acts as the visual entry point for the pipeline.
 * It is a pure identity modifier that marks where data entered the pipeline
 * and exposes source metadata to the UI.
 *
 * ``sourceType`` reflects where the frame data entered the pipeline:
 * - ``empty``   — no data loaded yet
 * - ``file``    — loaded from a local file via the page UI or drag-drop
 * - ``backend`` — pushed by a remote controller over the WebSocket RPC
 */
export class DataSourceModifier extends BaseModifier {
  // Properties for UI binding
  public sourceType: "file" | "empty" | "backend" = "empty";
  public filename = "";

  // Visibility
  public showAtoms = true;
  public showBonds = true;
  public showBox = true;

  constructor() {
    super(
      `data-source-${Date.now()}`,
      "Data Source",
      new Set([ModifierCapability.TransformsData]),
    );
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    if (this.showAtoms && this.showBonds && this.showBox) {
      return input;
    }

    // Visibility flags are currently used for UI state only.
    // Frame-level block filtering is intentionally a no-op in v0.0.2.
    return input;
  }
}
