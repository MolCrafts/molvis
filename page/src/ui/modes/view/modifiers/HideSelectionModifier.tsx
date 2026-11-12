import type {
  HideSelectionModifier as CoreHideModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import { Label } from "@molcrafts/ui";
import type React from "react";

interface ModifierProps {
  modifier: CoreHideModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

/**
 * Property panel for {@link CoreHideModifier}. The modifier removes the atoms
 * selected by the bound selection producer, so the panel only reports the
 * result of the last run — there are no per-modifier parameters to edit.
 */
export const HideSelectionModifier: React.FC<ModifierProps> = ({
  modifier,
  app,
}) => {
  const count = app ? modifier.hiddenCount : 0;

  return (
    <fieldset
      disabled={!app}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-label"
    >
      <div className="flex items-center justify-between">
        <Label>Hidden atoms</Label>
        <span className="font-mono text-muted-foreground">
          {count.toLocaleString()}
        </span>
      </div>
    </fieldset>
  );
};
