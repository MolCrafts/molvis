/**
 * Saving a blob to the user's disk, shared by every MolVis surface.
 *
 * `sketch` and `stage` had one mechanism each and neither could reach the
 * other's: stage opened a File System Access picker and *threw* where the
 * API was missing (Firefox, Safari, most embedded webviews); sketch always
 * used an anchor download and so never offered a picker even in browsers
 * that support one. This module does the picker when available and falls
 * back to the anchor, so both surfaces behave the same everywhere.
 */

// File System Access API — not yet in lib.dom.d.ts.
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable(): Promise<{
        write(data: Blob): Promise<void>;
        close(): Promise<void>;
      }>;
    }>;
  }
}

export interface SaveFileType {
  description?: string;
  /** MIME type → extensions, e.g. `{ "chemical/x-pdb": [".pdb"] }`. */
  accept: Record<string, string[]>;
}

export interface SaveBlobOptions {
  /**
   * File-type filters for the save picker. Ignored by the anchor
   * fallback, which can only honour the suggested filename.
   */
  types?: SaveFileType[];
}

/**
 * Write `blob` to a user-chosen location.
 *
 * Resolves once the bytes are handed off. The anchor fallback resolves as
 * soon as the download is triggered — the browser owns it from there, so
 * neither path can report where the file actually landed.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  options: SaveBlobOptions = {},
): Promise<void> {
  const picker =
    typeof window !== "undefined" ? window.showSaveFilePicker : undefined;

  if (typeof picker === "function") {
    const handle = await picker({ suggestedName, types: options.types });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  downloadBlob(blob, suggestedName);
}

/**
 * Anchor-based download — the fallback for hosts without the File System
 * Access API. Exported because a caller may want to force it (a headless
 * or automated context where a picker would block).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    // Revoking synchronously can cancel the download in some browsers;
    // give the click a turn of the event loop first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
