import type { Modifier, Molvis } from "@molvis/core";
import type React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAvailableParents, getSelectionLabel } from "./tree_utils";

const NONE_VALUE = "__none__";

interface ParentSelectorProps {
  modifier: Modifier;
  allModifiers: readonly Modifier[];
  app: Molvis | null;
  onUpdate: () => void;
}

export const ParentSelector: React.FC<ParentSelectorProps> = ({
  modifier,
  allModifiers,
  app,
  onUpdate,
}) => {
  const parents = getAvailableParents(modifier.id, allModifiers);
  const currentValue = modifier.selectionScopeId ?? NONE_VALUE;

  const handleChange = (value: string) => {
    if (!app) return;
    const selectionScopeId = value === NONE_VALUE ? null : value;
    const success = app.modifierPipeline.setSelectionScope(
      modifier.id,
      selectionScopeId,
    );
    if (success) {
      onUpdate();
      void app.applyPipeline({ fullRebuild: true });
    }
  };

  return (
    <div className="space-y-2 mb-4 pb-4 border-b">
      <Label className="text-xs">Selection scope</Label>
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder="All atoms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>All atoms</SelectItem>
          {parents.map((mod) => (
            <SelectItem key={mod.id} value={mod.id}>
              {getSelectionLabel(mod)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
