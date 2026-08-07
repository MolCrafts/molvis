import type { Molvis } from "@molcrafts/molvis-stage";
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
  toIoError,
} from "@molcrafts/molvis-stage/io";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerAction } from "@/components/viewer/ViewerAction";

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
 * `mode` controls load semantics: `"replace"` clears the scene, `"augment"`
 * adds another source, and `"extend"` concatenates at load time.
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

/**
 * Outcome of {@link loadFileSmart}. Parse / molrs failures **throw** an
 * `Error` whose message is the molrs/WASM detail (never a bare
 * "Failed to load <name>"). Only cancel returns `"cancelled"`.
 */
export type LoadFileResult = "started" | "cancelled";

/**
 * Single ingress for any user-supplied `File`. Routes large files
 * through the streaming worker pipeline and small files through the
 * whole-content reader.
 *
 * On success returns `"started"`. On user cancel returns `"cancelled"`.
 * On parse/format failure **throws** with the molrs error message so the
 * page status bar / operation runner can show the real cause (line/section
 * mismatch, wrong format, etc.).
 *
 * Both `DataSource` (file picker) and `MolvisWrapper` (drag-drop)
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
    // Re-throw so UI operation runners show molrs detail as the status
    // detail line (not a second generic "Failed to load <name>").
    throw toIoError(err, `Failed to load ${file.name}`);
  }
}

interface FormatPickerDialogProps {
  filename: string;
  reason: PickerReason;
  onPick: (format: FileFormat) => void;
  onCancel: () => void;
}

/**
 * Prefer a format when the basename contains a strong cue (e.g. "dump",
 * "traj", "poscar"). Used only as the initial Select value for unknown
 * extensions — the user always confirms before load.
 */
function guessFormatFromBasename(filename: string): FileFormat | null {
  const base = filename.trim().toLowerCase();
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const name = slash >= 0 ? base.slice(slash + 1) : base;

  if (
    /\b(dump|lammpstrj|lmptrj|lammpsdump)\b/.test(name) ||
    name.endsWith(".out")
  ) {
    return "lammps-dump";
  }
  if (/\b(data|lammpsdata)\b/.test(name) || name.endsWith(".lmp")) {
    return "lammps";
  }
  if (/\b(poscar|contcar)\b/.test(name)) return "poscar";
  if (/\bchgcar\b/.test(name)) return "chgcar";
  if (name.endsWith(".pdb") || name.endsWith(".ent")) return "pdb";
  if (name.endsWith(".xyz") || name.endsWith(".extxyz")) return "xyz";
  if (name.endsWith(".gro")) return "gro";
  if (name.endsWith(".cif") || name.endsWith(".mmcif")) return "cif";
  if (name.endsWith(".dcd")) return "dcd";
  if (name.endsWith(".trr")) return "trr";
  if (name.endsWith(".xtc")) return "xtc";
  if (name.endsWith(".mol2")) return "mol2";
  if (name.endsWith(".sdf") || name.endsWith(".mol")) return "sdf";
  if (name.endsWith(".cube") || name.endsWith(".cub")) return "cube";
  return null;
}

const FormatPickerDialog: React.FC<FormatPickerDialogProps> = ({
  filename,
  reason: _reason,
  onPick,
  onCancel,
}) => {
  const guessed = useMemo(() => guessFormatFromBasename(filename), [filename]);
  const [selected, setSelected] = useState<FileFormat | "">(
    guessed ?? FILE_FORMAT_REGISTRY[0]?.format ?? "",
  );

  const handleConfirm = useCallback(() => {
    if (!selected) return;
    onPick(selected);
  }, [selected, onPick]);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-dialog-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Select file format</DialogTitle>
          {/* Visually hidden: DialogContent requires a Description for a11y. */}
          <DialogDescription className="sr-only">
            Choose a parser for {filename}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="truncate font-mono text-xs" title={filename}>
            {filename}
          </div>

          <div className="form-grid-columns grid items-center gap-2">
            <Label
              htmlFor="file-format-select"
              className="text-xs text-muted-foreground"
            >
              File format
            </Label>
            <Select
              value={selected}
              onValueChange={(v) => setSelected(v as FileFormat)}
            >
              <SelectTrigger
                id="file-format-select"
                className="h-8 w-full min-w-0 text-xs"
              >
                <SelectValue placeholder="Choose a format…" />
              </SelectTrigger>
              <SelectContent>
                {FILE_FORMAT_REGISTRY.map((d) => (
                  <SelectItem
                    key={d.format}
                    value={d.format}
                    className="text-xs"
                    textValue={d.label}
                  >
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <ViewerAction purpose="dismiss" onClick={onCancel}>
            Cancel
          </ViewerAction>
          <ViewerAction disabled={!selected} onClick={handleConfirm}>
            Import
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
