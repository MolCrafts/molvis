/**
 * Compute-panel registry. Product panels and plugins fill
 * {@link AnalysisPanelShell} (controls on top, results below) by registering
 * here; {@link LeftSidebar} only looks up an id.
 */

import type {
  AnalysisAtomSelection,
  AnalysisDefinition,
  FrameRange,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";

export interface ComputePanelProps {
  app: Molvis | null;
  definition?: AnalysisDefinition;
  frameRange: FrameRange;
  trajectoryLength: number;
  scopeBlocked: boolean;
  selection: AnalysisAtomSelection;
  blockedReason?: string;
  scopeSummary?: string;
  scopeNode: React.ReactNode;
}

export interface ComputePanelEntry {
  id: string;
  /** Hide the shared All/Selection toggle — this panel owns atom grouping. */
  ownsAtomScope?: boolean;
  render: (props: ComputePanelProps) => React.ReactNode;
}

const entries = new Map<string, ComputePanelEntry>();

/** Register a compute panel. Last writer for an id wins. */
export function registerComputePanel(entry: ComputePanelEntry): void {
  entries.set(entry.id, entry);
}

export function getComputePanel(id: string): ComputePanelEntry | undefined {
  return entries.get(id);
}

export function computePanelOwnsAtomScope(id: string): boolean {
  return entries.get(id)?.ownsAtomScope === true;
}

export function isRegisteredComputePanel(id: string): boolean {
  return entries.has(id);
}
