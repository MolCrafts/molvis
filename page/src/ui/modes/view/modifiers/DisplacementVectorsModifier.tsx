import {
  type DisplacementVectorsModifier as Core,
  DISPLACEMENT_X,
  DISPLACEMENT_Y,
  DISPLACEMENT_Z,
  type Molvis,
  nextModifierId,
  VectorFieldModifier,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DisplacementVectorsModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Computing displacements…",
      success: "Displacements updated",
      error: "Could not compute displacements",
    },
  );

  const addVectorField = () => {
    if (!app) return;
    const existing = app.modifierPipeline
      .modifiers()
      .find(
        (m) =>
          m instanceof VectorFieldModifier && m.config.vxCol === DISPLACEMENT_X,
      );
    if (!existing) {
      const vf = new VectorFieldModifier(nextModifierId("vf-disp"), {
        vxCol: DISPLACEMENT_X,
        vyCol: DISPLACEMENT_Y,
        vzCol: DISPLACEMENT_Z,
        colorMode: "magnitude",
        scale: 1,
      });
      app.modifierPipeline.addModifier(vf);
    }
    void applyPipeline({ fullRebuild: true });
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Reference frame index</Label>
        <Input
          type="number"
          min={0}
          step={1}
          className="h-8 text-xs"
          value={modifier.referenceFrame}
          onChange={(e) => {
            modifier.setReferenceFrame(Number(e.target.value));
            onUpdate();
          }}
          onBlur={() => void applyPipeline()}
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-control-compact w-full text-xs"
        disabled={!app || pipelineRunning}
        onClick={addVectorField}
      >
        Add Vector field (Displacement.*)
      </Button>
    </fieldset>
  );
};
