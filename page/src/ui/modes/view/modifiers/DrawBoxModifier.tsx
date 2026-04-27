import type {
  DrawBoxModifier as CoreDrawBoxModifier,
  Molvis,
} from "@molvis/core";
import type React from "react";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawBoxModifierProps {
  modifier: CoreDrawBoxModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DrawBoxModifier: React.FC<DrawBoxModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => (
  <div className="space-y-2 text-xs">
    <ScalarSliderRow
      label="Edge Thickness"
      value={modifier.thicknessScale}
      min={0.25}
      max={4.0}
      step={0.05}
      format={(v) => `${v.toFixed(2)}×`}
      onPreview={(v) => {
        modifier.thicknessScale = v;
        onUpdate();
      }}
      onCommit={(v) => {
        modifier.thicknessScale = v;
        void app?.applyPipeline();
        onUpdate();
      }}
    />
  </div>
);
