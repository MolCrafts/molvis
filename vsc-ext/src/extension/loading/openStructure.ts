import { FILE_FORMAT_REGISTRY } from "@molvis/core/io/formats";
import * as vscode from "vscode";

/**
 * Build VS Code open-dialog filters from the core format registry.
 * Includes a catch-all for Zarr directories (selected as folders).
 */
export function molecularOpenDialogFilters(): {
  [name: string]: string[];
} {
  const allExts = new Set<string>();
  const filters: { [name: string]: string[] } = {};

  for (const entry of FILE_FORMAT_REGISTRY) {
    const exts = [...entry.extensions];
    filters[entry.label] = exts;
    for (const ext of exts) allExts.add(ext);
  }

  // Zarr is path/stat-detected (directory), not a registry format with a
  // single extension used by the open dialog's file filter alone.
  allExts.add("zarr");
  filters["Zarr directory"] = ["zarr"];
  filters["All molecular files"] = [...allExts];
  filters["All files"] = ["*"];

  return filters;
}

/**
 * Prompt the user to pick a structure / trajectory file (or Zarr folder).
 * Returns `undefined` if the dialog is cancelled.
 */
export async function pickMolecularUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Open in MolVis",
    title: "Open molecular structure or trajectory",
    filters: molecularOpenDialogFilters(),
  });
  return picked?.[0];
}
