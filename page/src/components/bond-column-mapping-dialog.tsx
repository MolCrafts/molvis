import type {
  BondColumnMapping,
  BondMappingDecision,
  PickBondMapping,
} from "@molcrafts/molvis-stage/io";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
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
          <DialogTitle className="text-sm">Map bond columns</DialogTitle>
          <DialogDescription className="text-micro">
            Bonds block lacks canonical <code>atomi</code>/<code>atomj</code> —
            map which columns are the two endpoint atom IDs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="truncate font-mono text-xs" title={filename}>
            {filename}
          </div>

          <div className="form-grid-columns grid items-center gap-2">
            <Label
              htmlFor="atomi-select"
              className="text-xs text-muted-foreground"
            >
              First atom
            </Label>
            <Select value={atomiSource} onValueChange={setAtomiSource}>
              <SelectTrigger
                id="atomi-select"
                className="h-8 w-full min-w-0 text-xs"
              >
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((col) => (
                  <SelectItem key={col} value={col} className="text-xs">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label
              htmlFor="atomj-select"
              className="text-xs text-muted-foreground"
            >
              Second atom
            </Label>
            <Select value={atomjSource} onValueChange={setAtomjSource}>
              <SelectTrigger
                id="atomj-select"
                className="h-8 w-full min-w-0 text-xs"
              >
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((col) => (
                  <SelectItem key={col} value={col} className="text-xs">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="text-xs text-muted-foreground">Index base</Label>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bond-mapping-offset"
                  value="-1"
                  checked={offset === -1}
                  onChange={() => setOffset(-1)}
                  className="h-3.5 w-3.5"
                />
                <span>1-indexed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bond-mapping-offset"
                  value="0"
                  checked={offset === 0}
                  onChange={() => setOffset(0)}
                  className="h-3.5 w-3.5"
                />
                <span>0-indexed</span>
              </label>
            </div>
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
