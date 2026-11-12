import type {
  BondColumnMapping,
  BondMappingDecision,
  PickBondMapping,
} from "@molcrafts/molvis-stage/io";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleAction,
} from "@molcrafts/ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { ViewerAction } from "@/components/viewer/ViewerAction";

interface PickerState {
  filename: string;
  candidates: string[];
}

const BondMappingPickerContext = createContext<PickBondMapping | null>(null);

/**
 * Provides the OVITO-style "map columns to atomi/atomj" dialog as a
 * single shared modal, mirroring the {@link FormatPickerProvider}
 * pattern. The active load flow calls {@link useBondMappingPicker}'s
 * resolver when a parsed `bonds` block lacks the canonical index
 * columns; the dialog's resolution becomes the load's
 * {@link BondColumnMapping} (or `null` to cancel the load).
 */
export const BondMappingPickerProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<PickerState | null>(null);
  const resolverRef = useRef<((m: BondMappingDecision) => void) | null>(null);

  const close = useCallback((decision: BondMappingDecision) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolve?.(decision);
  }, []);

  const pickBondMapping = useCallback<PickBondMapping>(
    (filename, candidates) => {
      return new Promise<BondMappingDecision>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setState({ filename, candidates });
      });
    },
    [],
  );

  return (
    <BondMappingPickerContext.Provider value={pickBondMapping}>
      {children}
      {state && (
        <BondColumnMappingDialog
          filename={state.filename}
          candidates={state.candidates}
          onConfirm={(m) => close(m)}
          onCancel={() => close(null)}
        />
      )}
    </BondMappingPickerContext.Provider>
  );
};

export function useBondMappingPicker(): PickBondMapping {
  const value = useContext(BondMappingPickerContext);
  if (!value) {
    throw new Error(
      "useBondMappingPicker must be used within <BondMappingPickerProvider>",
    );
  }
  return value;
}

interface BondColumnMappingDialogProps {
  filename: string;
  candidates: string[];
  onConfirm: (mapping: BondColumnMapping) => void;
  onCancel: () => void;
}

const BondColumnMappingDialog: React.FC<BondColumnMappingDialogProps> = ({
  filename,
  candidates,
  onConfirm,
  onCancel,
}) => {
  // Default to the first two candidate columns. For LAMMPS dump local
  // bonds (`c_X[1] c_X[2] c_X[3]` etc.) the bond ID is usually first
  // and the two atom indices are next, so guessing the second and third
  // would often be more correct — but `c_X[2]` and `c_X[3]` aren't a
  // universal convention. First-two is the safest starting guess and
  // the user can override before confirming.
  const initialI = candidates[0] ?? "";
  const initialJ = candidates[1] ?? candidates[0] ?? "";

  const [atomiSource, setAtomiSource] = useState(initialI);
  const [atomjSource, setAtomjSource] = useState(initialJ);
  // Default offset = -1: LAMMPS dump-local writes 1-indexed atom IDs.
  // Users loading already-0-indexed data flip the radio.
  const [offset, setOffset] = useState<number>(-1);

  const conflict = atomiSource && atomjSource && atomiSource === atomjSource;
  const canConfirm = atomiSource && atomjSource && !conflict;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm({ atomiSource, atomjSource, offset });
  }, [atomiSource, atomjSource, offset, canConfirm, onConfirm]);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-dialog-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Map bond columns</DialogTitle>
          <DialogDescription>
            Bonds block lacks canonical <code>atomi</code>/<code>atomj</code> —
            map which columns are the two endpoint atom IDs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="truncate font-mono text-label" title={filename}>
            {filename}
          </div>

          <div className="form-grid-columns grid items-center gap-2">
            <Label
              htmlFor="atomi-select"
              className="text-label text-muted-foreground"
            >
              First atom
            </Label>
            <Select value={atomiSource} onValueChange={setAtomiSource}>
              <SelectTrigger
                id="atomi-select"
                className="h-control-compact w-full min-w-0 text-label"
              >
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((col) => (
                  <SelectItem key={col} value={col} className="text-label">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label
              htmlFor="atomj-select"
              className="text-label text-muted-foreground"
            >
              Second atom
            </Label>
            <Select value={atomjSource} onValueChange={setAtomjSource}>
              <SelectTrigger
                id="atomj-select"
                className="h-control-compact w-full min-w-0 text-label"
              >
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((col) => (
                  <SelectItem key={col} value={col} className="text-label">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="text-label text-muted-foreground">
              Index base
            </Label>
            <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">Index base</legend>
              <ToggleAction
                selected={offset === -1}
                onClick={() => setOffset(-1)}
              >
                1-indexed
              </ToggleAction>
              <ToggleAction
                selected={offset === 0}
                onClick={() => setOffset(0)}
              >
                0-indexed
              </ToggleAction>
            </fieldset>
          </div>

          <p className="text-micro text-muted-foreground leading-snug">
            Values resolve against <code>atoms.id</code> when present. Index
            base applies only as a fallback for positional indices.
          </p>

          {conflict && (
            <div className="text-micro text-status-failed-foreground">
              First and second atom columns must differ.
            </div>
          )}
        </div>

        <DialogFooter>
          <ViewerAction purpose="dismiss" onClick={onCancel}>
            Cancel
          </ViewerAction>
          <ViewerAction disabled={!canConfirm} onClick={handleConfirm}>
            Apply mapping
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
