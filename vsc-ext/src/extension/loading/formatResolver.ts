import {
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  inferFormatFromFilename,
} from "@molcrafts/molvis-stage/io/formats";
import * as vscode from "vscode";

/**
 * Resolve a molecular file format for `filename`. Returns the inferred
 * format when the extension matches the registry; otherwise shows a
 * VS Code quick pick so the user can choose. Returns `null` when the
 * user dismisses the picker, which callers should treat as "do not
 * load the file".
 *
 * Zarr payloads are detected by path / stat upstream and never reach
 * this helper, so we don't list a Zarr option here.
 */
export async function resolveFileFormat(
  filename: string,
): Promise<FileFormat | null> {
  const inferred = inferFormatFromFilename(filename);
  if (inferred) return inferred;

  const items: Array<vscode.QuickPickItem & { format: FileFormat }> =
    FILE_FORMAT_REGISTRY.map((entry) => ({
      label: entry.label,
      description: entry.extensions.map((e) => `.${e}`).join(" "),
      detail: entry.description,
      format: entry.format,
    }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Pick a format for "${filename}"`,
    placeHolder: "MolVis couldn't infer a format from the extension",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });

  return picked?.format ?? null;
}
