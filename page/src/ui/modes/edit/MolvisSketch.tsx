import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  type MoleculeData,
  type SketchBoardState,
  SketchComposer,
} from "@molcrafts/molvis-sketch";
import { ExternalLink, Minimize2 } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ViewerToolButton } from "@/components/viewer/ViewerToolButton";
import { cn } from "@/lib/utils";

export interface MolvisSketchRef {
  getMoleculeData(): MoleculeData | null;
  toFrame(): Frame | null;
  getState(): SketchBoardState | null;
  toSvg(): string | null;
  toPng(): Promise<Blob | null>;
}

export interface MolvisSketchProps {
  minHeight?: number;
  disabled?: boolean;
  /**
   * Host-only icon actions injected into the sketch common rail `extraSlot`
   * (layout slot — never overlaid on top of chem tools). e.g. generate-3D.
   */
  extraActions?: ReactNode;
  /** Host-specific file sink. Browser downloads are used when omitted. */
  onExportFile?: (blob: Blob, filename: string) => void | Promise<void>;
  /** Whether the editor can move into a page-level modal. Default true. */
  allowPopout?: boolean;
  className?: string;
}

/** After reparent, stage geometry may lag one frame — resize when measurable. */
function syncBoardToStage(composer: SketchComposer, shell: HTMLElement): void {
  const stage = shell.querySelector(
    ".molvis-sketch-composer__stage",
  ) as HTMLElement | null;
  if (!stage) return;
  const apply = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (width < 1 || height < 1) return false;
    composer.board.resize(width, height);
    return true;
  };
  if (apply()) return;
  requestAnimationFrame(() => {
    if (apply()) return;
    requestAnimationFrame(() => {
      apply();
    });
  });
}

/**
 * React host for `@molcrafts/molvis-sketch` {@link SketchComposer}.
 *
 * - Chrome lives in sketch (`gui: true`); page does not reimplement rails.
 * - Product look: Tailwind maps tokens → `--msk-*` via `.molvis-sketch-host`.
 * - Pop-out / generate-3D: portal into `composer.extraSlot` (common rail end).
 * - Pop-out reparents a stable shell node (no remount). Shell is moved **back
 *   to the inline anchor before** the dialog unmounts so React never discards
 *   the board with the portal content.
 */
export const MolvisSketch = forwardRef<MolvisSketchRef, MolvisSketchProps>(
  (
    {
      minHeight = 240,
      disabled = false,
      extraActions,
      onExportFile,
      allowPopout = true,
      className,
    },
    ref,
  ) => {
    const inlineAnchorRef = useRef<HTMLDivElement>(null);
    const dialogAnchorRef = useRef<HTMLDivElement | null>(null);
    const onExportFileRef = useRef(onExportFile);
    onExportFileRef.current = onExportFile;

    // Imperative shell so pop-out can reparent without React unmounting the board.
    const shellRef = useRef<HTMLDivElement | null>(null);
    if (shellRef.current === null && typeof document !== "undefined") {
      const shell = document.createElement("div");
      shell.className =
        "molvis-sketch-host flex h-full min-h-0 w-full min-w-0 flex-1 flex-col";
      shellRef.current = shell;
    }

    const [composer] = useState(
      () =>
        new SketchComposer({
          gui: true,
          onExportFile: (blob, filename) =>
            onExportFileRef.current?.(blob, filename),
        }),
    );
    const [poppedOut, setPoppedOut] = useState(false);
    const [extraSlot, setExtraSlot] = useState<HTMLElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getMoleculeData() {
          const data = composer.board.getMoleculeData();
          if (data.atoms.length === 0) return null;
          return data;
        },
        toFrame() {
          if (composer.board.getMoleculeData().atoms.length === 0) return null;
          return composer.board.toFrame();
        },
        getState() {
          return composer.board.getState();
        },
        toSvg() {
          if (composer.board.getMoleculeData().atoms.length === 0) return null;
          return composer.board.toSvg();
        },
        async toPng() {
          if (composer.board.getMoleculeData().atoms.length === 0) return null;
          return composer.board.toPng();
        },
      }),
      [composer],
    );

    useEffect(() => {
      const shell = shellRef.current;
      if (!shell) return;
      composer.mount(shell);
      setExtraSlot(composer.extraSlot);
      return () => {
        composer.unmount();
        setExtraSlot(null);
      };
    }, [composer]);

    /** Park shell under `target` and re-measure the canvas. */
    const reparentShell = useCallback(
      (target: HTMLElement | null) => {
        const shell = shellRef.current;
        if (!shell || !target) return;
        if (shell.parentElement !== target) {
          target.appendChild(shell);
        }
        syncBoardToStage(composer, shell);
      },
      [composer],
    );

    // Inline parking when not popped out (also after return).
    useLayoutEffect(() => {
      if (poppedOut) return;
      reparentShell(inlineAnchorRef.current);
    }, [poppedOut, reparentShell]);

    // Dialog mount: callback ref so we reparent as soon as the portal node exists
    // (useLayoutEffect alone can race Radix Presence / conditional Content).
    const setDialogAnchor = useCallback(
      (node: HTMLDivElement | null) => {
        dialogAnchorRef.current = node;
        if (node) {
          reparentShell(node);
        }
      },
      [reparentShell],
    );

    /**
     * Close path: move shell back to the inline anchor *before* React tears
     * down DialogContent (which would remove shell from the document tree).
     */
    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open) {
          reparentShell(inlineAnchorRef.current);
        }
        setPoppedOut(open);
      },
      [reparentShell],
    );

    useEffect(() => {
      composer.setDisabled(disabled);
    }, [composer, disabled]);

    const hostActions =
      extraSlot &&
      (allowPopout || extraActions) &&
      createPortal(
        <>
          {allowPopout && (
            <ViewerToolButton
              label={poppedOut ? "Return sketch to panel" : "Pop out sketch"}
              disabled={disabled}
              className="[&_svg]:shrink-0"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleOpenChange(!poppedOut);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {poppedOut ? <Minimize2 /> : <ExternalLink />}
            </ViewerToolButton>
          )}
          {extraActions}
        </>,
        extraSlot,
      );

    return (
      <Dialog open={poppedOut} onOpenChange={handleOpenChange}>
        {hostActions}
        <div
          ref={inlineAnchorRef}
          className={cn(
            "molvis-sketch-container flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
            // Keep in layout tree for reparent target; hide only visually when
            // the board lives in the dialog.
            poppedOut &&
              "invisible pointer-events-none absolute h-0 min-h-0 overflow-hidden p-0",
            className,
          )}
          style={{ minHeight: poppedOut ? 0 : minHeight }}
          aria-hidden={poppedOut || undefined}
        />
        {poppedOut && (
          <DialogContent
            aria-label="2D molecule sketch"
            // Override default `grid` — a grid row with h-full children collapses
            // to zero height and leaves the canvas blank after pop-out.
            className="flex h-[min(92vh,900px)] w-[min(94vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
            showCloseButton={false}
            // Prevent dismiss from wiping focus mid-draw; return via rail button.
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogTitle className="sr-only">2D molecule sketch</DialogTitle>
            <div
              ref={setDialogAnchor}
              className="molvis-sketch-container flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
            />
          </DialogContent>
        )}
      </Dialog>
    );
  },
);

MolvisSketch.displayName = "MolvisSketch";
