import {
  AssignColorModifier as CoreAssignColorModifier,
  ColorByPropertyModifier as CoreColorByPropertyModifier,
  DataSourceModifier as CoreDataSourceModifier,
  DrawAtomModifier as CoreDrawAtomModifier,
  DrawBondModifier as CoreDrawBondModifier,
  DrawBoxModifier as CoreDrawBoxModifier,
  DrawIsosurfaceModifier as CoreDrawIsosurfaceModifier,
  DrawRibbonModifier as CoreDrawRibbonModifier,
  ExpressionSelectionModifier as CoreExpressionSelectionModifier,
  HideSelectionModifier as CoreHideModifier,
  SelectModifier as CoreSelectModifier,
  SliceModifier as CoreSliceModifier,
  TransparentSelectionModifier as CoreTransparentSelectionModifier,
  type Modifier,
  ModifierCapability,
  type Molvis,
  isSelectionProducer,
  primaryCapabilityLabel,
} from "@molvis/core";
import type React from "react";
import { AssignColorModifier } from "./modifiers/AssignColorModifier";
import { ColorByPropertyModifier } from "./modifiers/ColorByPropertyModifier";
import { DataSourceModifier } from "./modifiers/DataSourceModifier";
import { DrawAtomModifier } from "./modifiers/DrawAtomModifier";
import { DrawBondModifier } from "./modifiers/DrawBondModifier";
import { DrawBoxModifier } from "./modifiers/DrawBoxModifier";
import { DrawIsosurfaceModifier } from "./modifiers/DrawIsosurfaceModifier";
import { DrawRibbonModifier } from "./modifiers/DrawRibbonModifier";
import { ExpressionSelectionModifier } from "./modifiers/ExpressionSelectionModifier";
import { HideSelectionModifier } from "./modifiers/HideSelectionModifier";
import { SelectModifierProps } from "./modifiers/SelectModifierProps";
import { SliceModifier } from "./modifiers/SliceModifier";
import { TransparentSelectionModifier } from "./modifiers/TransparentSelectionModifier";
import { ParentSelector } from "./pipeline/ParentSelector";

interface ModifierPropertiesProps {
  modifier: Modifier;
  allModifiers: readonly Modifier[];
  app: Molvis | null;
  onUpdate: () => void;
}

export const ModifierProperties: React.FC<ModifierPropertiesProps> = ({
  modifier,
  allModifiers,
  app,
  onUpdate,
}) => {
  const showParentSelector =
    modifier.capabilities.has(ModifierCapability.ConsumesSelection) &&
    !isSelectionProducer(modifier);

  let content: React.ReactNode = (
    <div className="p-2 bg-muted/20 border-t text-[10px] text-muted-foreground text-center">
      No properties available for {modifier.name}.
    </div>
  );

  if (modifier instanceof CoreDataSourceModifier) {
    content = (
      <DataSourceModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreSliceModifier) {
    content = (
      <SliceModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreExpressionSelectionModifier) {
    content = (
      <ExpressionSelectionModifier
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    );
  } else if (modifier instanceof CoreHideModifier) {
    content = (
      <HideSelectionModifier
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    );
  } else if (modifier instanceof CoreColorByPropertyModifier) {
    content = (
      <ColorByPropertyModifier
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    );
  } else if (modifier instanceof CoreAssignColorModifier) {
    content = (
      <AssignColorModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreTransparentSelectionModifier) {
    content = (
      <TransparentSelectionModifier
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    );
  } else if (modifier instanceof CoreSelectModifier) {
    content = (
      <SelectModifierProps modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreDrawAtomModifier) {
    content = (
      <DrawAtomModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreDrawBondModifier) {
    content = (
      <DrawBondModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreDrawBoxModifier) {
    content = (
      <DrawBoxModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreDrawRibbonModifier) {
    content = (
      <DrawRibbonModifier modifier={modifier} app={app} onUpdate={onUpdate} />
    );
  } else if (modifier instanceof CoreDrawIsosurfaceModifier) {
    content = (
      <DrawIsosurfaceModifier
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    );
  }

  return (
    <div className="p-2 bg-muted/20 border-t">
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate min-w-0">
          {modifier.name}
        </h4>
        <span className="shrink-0 text-[9px] bg-muted px-1 py-0 rounded text-muted-foreground">
          {primaryCapabilityLabel(modifier.capabilities) ?? "modifier"}
        </span>
      </div>
      {showParentSelector && (
        <ParentSelector
          modifier={modifier}
          allModifiers={allModifiers}
          app={app}
          onUpdate={onUpdate}
        />
      )}
      {content}
    </div>
  );
};
