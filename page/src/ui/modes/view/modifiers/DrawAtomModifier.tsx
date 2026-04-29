import type {
  DrawAtomModifier as CoreDrawAtomModifier,
  Molvis,
} from "@molvis/core";
import type React from "react";
import { RepresentationSelectRow } from "./RepresentationSelectRow";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawAtomModifierProps {
  modifier: CoreDrawAtomModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DrawAtomModifier: React.FC<DrawAtomModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => (
  <div className="space-y-2 text-xs">
    <RepresentationSelectRow app={app} />

    <ScalarSliderRow
      label="Radius Scale"
      value={modifier.radiusScale}
      min={0.1}
      max={3.0}
      step={0.05}
      format={(v) => `${v.toFixed(2)}×`}
      onPreview={(v) => {
        modifier.radiusScale = v;
        onUpdate();
      }}
      onCommit={(v) => {
        modifier.radiusScale = v;
        void app?.applyPipeline();
        onUpdate();
      }}
    />
  </div>
);
