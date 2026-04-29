import type {
  DrawBondModifier as CoreDrawBondModifier,
  Molvis,
} from "@molvis/core";
import type React from "react";
import { RepresentationSelectRow } from "./RepresentationSelectRow";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawBondModifierProps {
  modifier: CoreDrawBondModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DrawBondModifier: React.FC<DrawBondModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const styleDefault = app?.styleManager.getBondStyle(1).radius ?? 0.15;
  const display = modifier.radius ?? styleDefault;
  const isOverride = modifier.radius !== undefined;

  const reset = () => {
    if (!isOverride) return;
    modifier.radius = undefined;
    void app?.applyPipeline();
    onUpdate();
  };

  return (
    <div className="space-y-2 text-xs">
      <RepresentationSelectRow app={app} />

      <ScalarSliderRow
        label="Radius"
        value={display}
        min={0.02}
        max={0.5}
        step={0.005}
        format={(v) => v.toFixed(3)}
        onPreview={(v) => {
          modifier.radius = v;
          onUpdate();
        }}
        onCommit={(v) => {
          modifier.radius = v;
          void app?.applyPipeline();
          onUpdate();
        }}
        accessory={
          <button
            type="button"
            onClick={reset}
            disabled={!isOverride}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Use representation default"
          >
            {isOverride ? "reset" : "default"}
          </button>
        }
      />
    </div>
  );
};
