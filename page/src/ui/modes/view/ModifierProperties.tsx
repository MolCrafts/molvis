import {
  DataSource,
  type Modifier,
  ModifierCapability,
  type Molvis,
  type PipelineEntry,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { modifierUsesLeftConfig, resolveModifierPanel } from "@/plugins";
import { dataSourceDisplayTitle } from "./modifiers/DataSourcePanel";
import { ParentSelector } from "./pipeline/ParentSelector";

interface ModifierPropertiesProps {
  modifier: PipelineEntry;
  allEntries: readonly PipelineEntry[];
  app: Molvis | null;
  onUpdate: () => void;
}

export const ModifierProperties: React.FC<ModifierPropertiesProps> = ({
  modifier,
  allEntries,
  app,
  onUpdate,
}) => {
  // Any selection consumer (incl. Invert/Expand which also produce) can
  // pick which upstream producer scopes its input.
  const showParentSelector =
    !(modifier instanceof DataSource) &&
    (modifier as Modifier).capabilities.has(
      ModifierCapability.ConsumesSelection,
    );

  // Analysis-nature / mesh modifiers: left = compute, right = draw params.
  const usesLeft = modifierUsesLeftConfig(modifier);
  const Panel = resolveModifierPanel(modifier);
  const content: React.ReactNode = Panel ? (
    <Panel
      modifier={modifier}
      app={app}
      onUpdate={onUpdate}
      surface={usesLeft ? "draw" : "full"}
    />
  ) : usesLeft ? (
    <p className="text-micro text-muted-foreground text-center px-1">
      Drawing parameters appear here. Compute parameters are on the left panel —
      select this step again if the left panel is closed.
    </p>
  ) : (
    <div className="p-2 bg-muted/20 border-t text-micro text-muted-foreground text-center">
      No properties available for {modifier.name}.
    </div>
  );

  const title =
    modifier instanceof DataSource
      ? dataSourceDisplayTitle(modifier)
      : modifier.name;

  return (
    <div className="border-t bg-muted/20 p-2">
      <h4 className="mb-2 truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {showParentSelector && (
        <ParentSelector
          // `showParentSelector` already excluded sources — only a modifier
          // reaches here.
          modifier={modifier as Modifier}
          allEntries={allEntries}
          app={app}
          onUpdate={onUpdate}
        />
      )}
      {content}
    </div>
  );
};
