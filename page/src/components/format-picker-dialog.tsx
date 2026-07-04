import type { Molvis } from "@molvis/core";
import {
  BondMappingCancelledError,
  canStream,
  FILE_FORMAT_REGISTRY,
  type FileContent,
  type FileFormat,
  inferFormatFromFilename,
  isBinaryFormat,
  type LoadFileStreamOptions,
  type LoadFileStreamResult,
  type LoadMode,
  loadFileContent,
  loadFileStream,
  type PickBondMapping,
} from "@molvis/core/io";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PickerReason = "unknown-extension" | "no-extension";

interface PickerState {
  filename: string;
  reason: PickerReason;
}

type PickFormat = (
  filename: string,
  reason: PickerReason,
) => Promise<FileFormat | null>;

const FormatPickerContext = createContext<PickFormat | null>(null);

/**
 * Provides a single shared format-picker dialog to the rest of the app.
 * Any consumer can call `useFormatPicker()` to get an async
 * `pickFormat(filename, reason)` that resolves with the user's pick
 * (or `null` on cancel). The dialog itself is mounted once at the
 * provider root so every ingress point uses the same modal.
 */
export const FormatPickerProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<PickerState | null>(null);
  const resolverRef = useRef<((format: FileFormat | null) => void) | null>(
    null,
  );

  const close = useCallback((format: FileFormat | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolve?.(format);
  }, []);

  const pickFormat = useCallback<PickFormat>((filename, reason) => {
    return new Promise<FileFormat | null>((resolve) => {
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setState({ filename, reason });
    });
  }, []);

  return (
    <FormatPickerContext.Provider value={pickFormat}>
      {children}
      {state && (
        <FormatPickerDialog
          filename={state.filename}
          reason={state.reason}
          onPick={(format) => close(format)}
          onCancel={() => close(null)}
        />
      )}
    </FormatPickerContext.Provider>
  );
};

/**
 * Returns the `pickFormat(filename, reason)` helper. Throws if called
 * outside a `<FormatPickerProvider>` — that is by design so a silent
 * fallback never reintroduces the old "guess pdb" behavior.
 */
export function useFormatPicker(): PickFormat {
  const value = useContext(FormatPickerContext);
  if (!value) {
    throw new Error(
      "useFormatPicker must be used within <FormatPickerProvider>",
    );
  }
  return value;
}

/**
 * Resolve a FileFormat for `filename` (by extension, otherwise by prompting
 * the user) and call `loadFileContent`. Returns `true` if the load began,
 * `false` if the user cancelled the picker.
 *
 * `mode` controls multi-data-source semantics — `"replace"` (default)
 * clears the pipeline data source and installs this file as the new
 * primary; `"append"` adds it alongside any existing DSs via the spec's
 * load decision tree.
 */
export async function loadFileWithFormatPrompt(
  app: Molvis,
  content: FileContent,
  filename: string,
  pickFormat: PickFormat,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<boolean> {
  // Non-string payloads (Uint8Array for binary formats, Record for zarr
  // directories) skip the format prompt — the caller has already
  // committed to a parse path by the choice of read method
  // (`arrayBuffer` for binary, `loadZarrFiles` for zarr). loadFileContent
  // will infer the format from the filename or throw if the descriptor
  // doesn't match the payload kind.
  if (typeof content !== "string") {
    await loadFileContent(
      app,
      content,
      filename,
      undefined,
      mode,
      pickBondMapping,
    );
    return true;
  }

  const inferred = inferFormatFromFilename(filename);
  if (inferred) {
    await loadFileContent(
      app,
      content,
      filename,
      inferred,
      mode,
      pickBondMapping,
    );
    return true;
  }

  const reason = filename.includes(".") ? "unknown-extension" : "no-extension";
  const picked = await pickFormat(filename, reason);
  if (!picked) {
    return false;
  }
  await loadFileContent(app, content, filename, picked, mode, pickBondMapping);
  return true;
}

/**
 * Streaming variant of {@link loadFileWithFormatPrompt}. Takes a `File`
 * directly (not its decoded text content) and dispatches to the
 * Dedicated Worker streaming pipeline via `loadFileStream`. Resolves
 * with `null` on user cancel; otherwise with the live `TrajectoryRuntime`
 * the caller can hold for status / cancellation.
 *
 * The format-resolution flow mirrors the plain-text load path: extension
 * inference first, picker fallback for unknown extensions.
 */
export async function loadFileStreamWithFormatPrompt(
  app: Molvis,
  file: File,
  pickFormat: PickFormat,
  options?: LoadFileStreamOptions,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<LoadFileStreamResult | null> {
  const filename = file.name;
  const inferred = inferFormatFromFilename(filename);
  if (inferred) {
    return loadFileStream(
      app,
      file,
      filename,
      inferred,
      options,
      mode,
      pickBondMapping,
    );
  }
  const reason = filename.includes(".") ? "unknown-extension" : "no-extension";
  const picked = await pickFormat(filename, reason);
  if (!picked) return null;
  return loadFileStream(
    app,
    file,
    filename,
    picked,
    options,
    mode,
    pickBondMapping,
  );
}

/** Files larger than this threshold take the streaming worker path.
 *  The streaming path is correct at any size, but spawning a worker
 *  for a few-KB file is a net loss compared to the whole-content
 *  reader. */
const STREAMING_FILE_THRESHOLD = 16 * 1024 * 1024;

export type LoadFileResult = "started" | "cancelled" | "error";

/**
 * Single ingress for any user-supplied `File`. Routes large files
 * through the streaming worker pipeline and small files through the
 * whole-content reader, emits status-bar progress messages, and
 * surfaces errors as `status-message: error` events.
 *
 * Both `DataSourceModifier` (file picker) and `MolvisWrapper` (drag-drop)
 * funnel here so the two ingress paths stay consistent — same threshold,
 * same status copy, same error format.
 */
export async function loadFileSmart(
  app: Molvis,
  file: File,
  pickFormat: PickFormat,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<LoadFileResult> {
  try {
    // Infer format up front so we can route between the streaming worker
    // (text-only for now) and the eager path (which knows how to read
    // binary formats as bytes). Unknown-extension files fall through with
    // `inferred = null` and the prompt happens inside the chosen path.
    const inferred = inferFormatFromFilename(file.name);
    const eagerOnly = inferred !== null && !canStream(inferred);
    const useStreaming = file.size >= STREAMING_FILE_THRESHOLD && !eagerOnly;

    if (useStreaming) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      app.events.emit("status-message", {
        text: `Indexing ${file.name} (${sizeMB} MB)…`,
        type: "info",
      });
      const result = await loadFileStreamWithFormatPrompt(
        app,
        file,
        pickFormat,
        {
          onProgress: ({ bytesScanned, totalBytes, framesIndexedSoFar }) => {
            const pct = totalBytes
              ? ((bytesScanned / totalBytes) * 100).toFixed(0)
              : "0";
            app.events.emit("status-message", {
              text: `Indexing ${file.name}… ${pct}% — ${framesIndexedSoFar} frame(s)`,
              type: "info",
            });
          },
        },
        mode,
        pickBondMapping,
      );
      if (!result) {
        app.events.emit("status-message", {
          text: `Cancelled loading ${file.name}`,
          type: "info",
        });
        return "cancelled";
      }
      app.events.emit("status-message", {
        text: `Indexed ${file.name}`,
        type: "info",
      });
      return "started";
    }

    // Eager path. Binary formats (DCD) need raw bytes — `file.text()`
    // would corrupt the fixed-width Fortran record markers. For unknown
    // extensions we read as text; if the user later picks a binary
    // format from the prompt, loadBinaryTrajectory's payload guard
    // surfaces the mismatch with a directed error.
    const content =
      inferred !== null && isBinaryFormat(inferred)
        ? new Uint8Array(await file.arrayBuffer())
        : await file.text();
    const started = await loadFileWithFormatPrompt(
      app,
      content,
      file.name,
      pickFormat,
      mode,
      pickBondMapping,
    );
    if (!started) {
      app.events.emit("status-message", {
        text: `Cancelled loading ${file.name}`,
        type: "info",
      });
      return "cancelled";
    }
    return "started";
  } catch (err) {
    if (err instanceof BondMappingCancelledError) {
      app.events.emit("status-message", {
        text: `Cancelled loading ${file.name}`,
        type: "info",
      });
      return "cancelled";
    }
    const message = err instanceof Error ? err.message : String(err);
    app.events.emit("status-message", {
      text: `Failed to load ${file.name}: ${message}`,
      type: "error",
    });
    return "error";
  }
}

interface FormatPickerDialogProps {
  filename: string;
  reason: PickerReason;
  onPick: (format: FileFormat) => void;
  onCancel: () => void;
}

const FormatPickerDialog: React.FC<FormatPickerDialogProps> = ({
  filename,
  reason,
  onPick,
  onCancel,
}) => {
  const title =
    reason === "no-extension"
      ? "File has no extension"
      : "Unrecognized file extension";
  const describe = useMemo(
    () =>
      reason === "no-extension"
        ? `MolVis couldn't infer a format because "${filename}" has no extension. Pick a parser below.`
        : `MolVis doesn't recognize the extension of "${filename}". Pick the parser you'd like to use.`,
    [filename, reason],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{describe}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {FILE_FORMAT_REGISTRY.map((entry) => (
            <li key={entry.format}>
              <button
                type="button"
                onClick={() => onPick(entry.format)}
                className="w-full text-left border rounded-md px-3 py-2 hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {entry.extensions.map((e) => `.${e}`).join(" ")}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {entry.description}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
