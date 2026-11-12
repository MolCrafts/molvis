import type {
  MeshOverlayModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import { Label } from "@molcrafts/ui";
import type React from "react";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
}

/**
 * An imported mesh has nothing to configure — its triangles came off disk and
 * its appearance belongs to the `Draw surface` beneath it. What the row is
 * missing without a panel is its identity, so this says which file it is and
 * how big it is, and calls out the one state where it paints nothing: a
 * project restored without the file that carried the geometry.
 */
export const MeshOverlayModifier: React.FC<Props> = ({ modifier }) => {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-micro text-muted-foreground">Source file</Label>
        <div
          className="truncate font-mono text-label"
          title={modifier.sourceName || "unknown"}
        >
          {modifier.sourceName || "unknown"}
        </div>
      </div>
      {modifier.hasMesh ? (
        <div className="text-micro text-muted-foreground tabular-nums">
          {modifier.triangleCount.toLocaleString()} triangles · fixed geometry,
          unaffected by playback
        </div>
      ) : (
        <div className="text-micro text-muted-foreground">
          Geometry is not saved in a project. Open the file again to paint it.
        </div>
      )}
    </div>
  );
};
