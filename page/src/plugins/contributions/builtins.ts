/**
 * Wire built-in modifier property panels into the contribution registry.
 * Called once at page boot so {@link ModifierProperties} no longer needs a
 * hard-coded instanceof chain for the common cases (matchers cover the rest).
 */

import {
  AffineTransformationModifier as CoreAffineTransformationModifier,
  AssignColorModifier as CoreAssignColorModifier,
  CameraTrackModifier as CoreCameraTrackModifier,
  CenterOfMassModifier as CoreCenterOfMassModifier,
  ClusterModifier as CoreClusterModifier,
  ColorByPropertyModifier as CoreColorByPropertyModifier,
  ComputeBondsModifier as CoreComputeBondsModifier,
  ComputePropertyModifier as CoreComputePropertyModifier,
  ConstructSurfaceMeshModifier as CoreConstructSurfaceMeshModifier,
  CoordinationPolyhedraModifier as CoreCoordinationPolyhedraModifier,
  DisplacementVectorsModifier as CoreDisplacementVectorsModifier,
  DrawAtomModifier as CoreDrawAtomModifier,
  DrawBondModifier as CoreDrawBondModifier,
  DrawBoxModifier as CoreDrawBoxModifier,
  DrawIsosurfaceModifier as CoreDrawIsosurfaceModifier,
  DrawRibbonModifier as CoreDrawRibbonModifier,
  EditTypesModifier as CoreEditTypesModifier,
  ExpandSelectionModifier as CoreExpandSelectionModifier,
  ExpressionSelectionModifier as CoreExpressionSelectionModifier,
  FreezePropertyModifier as CoreFreezePropertyModifier,
  GaussianDensitySurfaceModifier as CoreGaussianDensitySurfaceModifier,
  HideSelectionModifier as CoreHideModifier,
  RadiusOfGyrationModifier as CoreRadiusOfGyrationModifier,
  ReplicateModifier as CoreReplicateModifier,
  SelectModifier as CoreSelectModifier,
  SelectOverlappingModifier as CoreSelectOverlappingModifier,
  SelectTypeModifier as CoreSelectTypeModifier,
  SliceModifier as CoreSliceModifier,
  SmoothTrajectoryModifier as CoreSmoothTrajectoryModifier,
  SolidLiquidModifier as CoreSolidLiquidModifier,
  SteinhardtOrderModifier as CoreSteinhardtOrderModifier,
  TrajectoryLinesModifier as CoreTrajectoryLinesModifier,
  TransparentSelectionModifier as CoreTransparentSelectionModifier,
  UnwrapTrajectoriesModifier as CoreUnwrapTrajectoriesModifier,
  VectorFieldModifier as CoreVectorFieldModifier,
  DataSource,
  type PipelineEntry,
  Session,
} from "@molcrafts/molvis-stage";
import { AffineTransformationModifier } from "@/ui/modes/view/modifiers/AffineTransformationModifier";
import { AssignColorModifier } from "@/ui/modes/view/modifiers/AssignColorModifier";
import { CameraTrackModifier } from "@/ui/modes/view/modifiers/CameraTrackModifier";
import { CenterOfMassModifier } from "@/ui/modes/view/modifiers/CenterOfMassModifier";
import { ClusterModifier } from "@/ui/modes/view/modifiers/ClusterModifier";
import { ColorByPropertyModifier } from "@/ui/modes/view/modifiers/ColorByPropertyModifier";
import { ComputeBondsModifier } from "@/ui/modes/view/modifiers/ComputeBondsModifier";
import { ComputePropertyModifier } from "@/ui/modes/view/modifiers/ComputePropertyModifier";
import { CoordinationPolyhedraModifier } from "@/ui/modes/view/modifiers/CoordinationPolyhedraModifier";
import { DataSourcePanel } from "@/ui/modes/view/modifiers/DataSourcePanel";
import { DisplacementVectorsModifier } from "@/ui/modes/view/modifiers/DisplacementVectorsModifier";
import { DrawAtomModifier } from "@/ui/modes/view/modifiers/DrawAtomModifier";
import { DrawBondModifier } from "@/ui/modes/view/modifiers/DrawBondModifier";
import { DrawBoxModifier } from "@/ui/modes/view/modifiers/DrawBoxModifier";
import { DrawIsosurfaceModifier } from "@/ui/modes/view/modifiers/DrawIsosurfaceModifier";
import { DrawRibbonModifier } from "@/ui/modes/view/modifiers/DrawRibbonModifier";
import { EditTypesModifier } from "@/ui/modes/view/modifiers/EditTypesModifier";
import { ExpandSelectionModifier } from "@/ui/modes/view/modifiers/ExpandSelectionModifier";
import { ExpressionSelectionModifier } from "@/ui/modes/view/modifiers/ExpressionSelectionModifier";
import { FreezePropertyModifier } from "@/ui/modes/view/modifiers/FreezePropertyModifier";
import { GaussianDensitySurfaceModifier } from "@/ui/modes/view/modifiers/GaussianDensitySurfaceModifier";
import { HideSelectionModifier } from "@/ui/modes/view/modifiers/HideSelectionModifier";
import { RadiusOfGyrationModifier } from "@/ui/modes/view/modifiers/RadiusOfGyrationModifier";
import { ReplicateModifier } from "@/ui/modes/view/modifiers/ReplicateModifier";
import { SelectModifierProps } from "@/ui/modes/view/modifiers/SelectModifierProps";
import { SelectOverlappingModifier } from "@/ui/modes/view/modifiers/SelectOverlappingModifier";
import { SelectTypeModifier } from "@/ui/modes/view/modifiers/SelectTypeModifier";
import { SessionPanel } from "@/ui/modes/view/modifiers/SessionPanel";
import { SliceModifier } from "@/ui/modes/view/modifiers/SliceModifier";
import { SmoothTrajectoryModifier } from "@/ui/modes/view/modifiers/SmoothTrajectoryModifier";
import { SolidLiquidModifier } from "@/ui/modes/view/modifiers/SolidLiquidModifier";
import { SteinhardtOrderModifier } from "@/ui/modes/view/modifiers/SteinhardtOrderModifier";
import { TrajectoryLinesModifier } from "@/ui/modes/view/modifiers/TrajectoryLinesModifier";
import { TransparentSelectionModifier } from "@/ui/modes/view/modifiers/TransparentSelectionModifier";
import { UnwrapTrajectoriesModifier } from "@/ui/modes/view/modifiers/UnwrapTrajectoriesModifier";
import { VectorFieldModifier } from "@/ui/modes/view/modifiers/VectorFieldModifier";
import type { ModifierPanelComponent } from "../types";
import { registerModifierPanelMatcher } from "./modifier_panels";

let registered = false;

export function registerBuiltinModifierPanels(): void {
  if (registered) return;
  registered = true;

  // Built-in panels are typed against concrete modifier classes; the
  // registry only knows `Modifier`. Casts are safe because matchers use
  // `instanceof` before rendering.
  const asPanel = (c: unknown): ModifierPanelComponent =>
    c as ModifierPanelComponent;

  const specs: Array<{
    id: string;
    match: (m: PipelineEntry) => boolean;
    component: ModifierPanelComponent;
    usesLeftConfig?: boolean;
  }> = [
    {
      id: "builtin:Session",
      match: (m) => m instanceof Session,
      component: asPanel(SessionPanel),
    },
    {
      id: "builtin:DataSource",
      match: (m) => m instanceof DataSource,
      component: asPanel(DataSourcePanel),
    },
    {
      id: "builtin:Slice",
      match: (m) => m instanceof CoreSliceModifier,
      component: asPanel(SliceModifier),
    },
    {
      id: "builtin:ExpressionSelect",
      match: (m) => m instanceof CoreExpressionSelectionModifier,
      component: asPanel(ExpressionSelectionModifier),
    },
    {
      id: "builtin:SelectType",
      match: (m) => m instanceof CoreSelectTypeModifier,
      component: asPanel(SelectTypeModifier),
    },
    {
      id: "builtin:ExpandSelection",
      match: (m) => m instanceof CoreExpandSelectionModifier,
      component: asPanel(ExpandSelectionModifier),
    },
    {
      id: "builtin:SelectOverlapping",
      match: (m) => m instanceof CoreSelectOverlappingModifier,
      component: asPanel(SelectOverlappingModifier),
    },
    {
      id: "builtin:HideSelection",
      match: (m) => m instanceof CoreHideModifier,
      component: asPanel(HideSelectionModifier),
    },
    {
      id: "builtin:AffineTransformation",
      match: (m) => m instanceof CoreAffineTransformationModifier,
      component: asPanel(AffineTransformationModifier),
    },
    {
      id: "builtin:Replicate",
      match: (m) => m instanceof CoreReplicateModifier,
      component: asPanel(ReplicateModifier),
    },
    {
      id: "builtin:UnwrapTrajectories",
      match: (m) => m instanceof CoreUnwrapTrajectoriesModifier,
      component: asPanel(UnwrapTrajectoriesModifier),
    },
    {
      id: "builtin:ComputeProperty",
      match: (m) => m instanceof CoreComputePropertyModifier,
      component: asPanel(ComputePropertyModifier),
    },
    {
      id: "builtin:FreezeProperty",
      match: (m) => m instanceof CoreFreezePropertyModifier,
      component: asPanel(FreezePropertyModifier),
    },
    {
      id: "builtin:EditTypes",
      match: (m) => m instanceof CoreEditTypesModifier,
      component: asPanel(EditTypesModifier),
    },
    {
      id: "builtin:DisplacementVectors",
      match: (m) => m instanceof CoreDisplacementVectorsModifier,
      component: asPanel(DisplacementVectorsModifier),
    },
    {
      id: "builtin:SmoothTrajectory",
      match: (m) => m instanceof CoreSmoothTrajectoryModifier,
      component: asPanel(SmoothTrajectoryModifier),
    },
    {
      id: "builtin:ColorByProperty",
      match: (m) => m instanceof CoreColorByPropertyModifier,
      component: asPanel(ColorByPropertyModifier),
    },
    {
      id: "builtin:ComputeBonds",
      match: (m) => m instanceof CoreComputeBondsModifier,
      component: asPanel(ComputeBondsModifier),
    },
    {
      id: "builtin:AssignColor",
      match: (m) => m instanceof CoreAssignColorModifier,
      component: asPanel(AssignColorModifier),
    },
    {
      id: "builtin:Transparent",
      match: (m) => m instanceof CoreTransparentSelectionModifier,
      component: asPanel(TransparentSelectionModifier),
    },
    {
      id: "builtin:Select",
      match: (m) => m instanceof CoreSelectModifier,
      component: asPanel(SelectModifierProps),
    },
    {
      id: "builtin:DrawAtom",
      match: (m) => m instanceof CoreDrawAtomModifier,
      component: asPanel(DrawAtomModifier),
    },
    {
      id: "builtin:DrawBond",
      match: (m) => m instanceof CoreDrawBondModifier,
      component: asPanel(DrawBondModifier),
    },
    {
      id: "builtin:DrawBox",
      match: (m) => m instanceof CoreDrawBoxModifier,
      component: asPanel(DrawBoxModifier),
    },
    {
      id: "builtin:DrawRibbon",
      match: (m) => m instanceof CoreDrawRibbonModifier,
      component: asPanel(DrawRibbonModifier),
    },
    {
      id: "builtin:DrawIsosurface",
      match: (m) => m instanceof CoreDrawIsosurfaceModifier,
      component: asPanel(DrawIsosurfaceModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:VectorField",
      match: (m) => m instanceof CoreVectorFieldModifier,
      component: asPanel(VectorFieldModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:GaussianDensitySurface",
      match: (m) =>
        m instanceof CoreGaussianDensitySurfaceModifier &&
        !(m instanceof CoreConstructSurfaceMeshModifier),
      component: asPanel(GaussianDensitySurfaceModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:ConstructSurfaceMesh",
      match: (m) => m instanceof CoreConstructSurfaceMeshModifier,
      component: asPanel(GaussianDensitySurfaceModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:CoordinationPolyhedra",
      match: (m) => m instanceof CoreCoordinationPolyhedraModifier,
      component: asPanel(CoordinationPolyhedraModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:TrajectoryLines",
      match: (m) => m instanceof CoreTrajectoryLinesModifier,
      component: asPanel(TrajectoryLinesModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:CameraTrack",
      match: (m) => m instanceof CoreCameraTrackModifier,
      component: asPanel(CameraTrackModifier),
    },
    {
      id: "builtin:SteinhardtOrder",
      match: (m) => m instanceof CoreSteinhardtOrderModifier,
      component: asPanel(SteinhardtOrderModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:SolidLiquid",
      match: (m) => m instanceof CoreSolidLiquidModifier,
      component: asPanel(SolidLiquidModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:Cluster",
      match: (m) => m instanceof CoreClusterModifier,
      component: asPanel(ClusterModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:CenterOfMass",
      match: (m) => m instanceof CoreCenterOfMassModifier,
      component: asPanel(CenterOfMassModifier),
      usesLeftConfig: true,
    },
    {
      id: "builtin:RadiusOfGyration",
      match: (m) => m instanceof CoreRadiusOfGyrationModifier,
      component: asPanel(RadiusOfGyrationModifier),
      usesLeftConfig: true,
    },
  ];

  for (const { id, match, component, usesLeftConfig } of specs) {
    registerModifierPanelMatcher({ id, match, component, usesLeftConfig });
  }
}
