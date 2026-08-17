import {
  DataSource,
  type Modifier,
  ModifierCapability,
  type Molvis,
  type PipelineEntry,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { DocsLink } from "@/components/viewer/DocsLink";
import { molpyDocsForModifier } from "@/lib/molpy-docs";
import { modifierUsesLeftConfig, resolveModifierPanel } from "@/plugins";
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
    <p className="px-1 text-center text-micro text-muted-foreground">
      Draw params here · compute on the left
    </p>
  ) : (
    <p className="px-1 text-center text-micro text-muted-foreground">
      No properties
    </p>
  );

  // First line is always the registry / type name ("Source", "Slice", …)
  // — never a filename or display alias.
  const title = modifier.name;
  const docsHref =
    modifier instanceof DataSource ? null : molpyDocsForModifier(modifier.name);

  return (
    <div className="border-t bg-muted/20 p-2">
      <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2">
        <h4 className="min-w-0 truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        {docsHref ? <DocsLink href={docsHref}>Handbook</DocsLink> : null}
      </div>
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
