import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearGroups,
  describeGroups,
  type StorageGroup,
  type StorageTier,
  storageGroups,
} from "@/lib/molvis-storage";

const TIER_NOTE: Record<StorageTier, string> = {
  cache: "Also removed by Clear cache.",
  config: "Preferences and installed plugins.",
};

export interface ResetMolvisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after storage was cleared, so the caller can remount. */
  onCleared: () => void;
}

/**
 * Pick what to erase before resetting MolVis.
 *
 * Presented as a choice rather than a single "clear everything" button
 * because the groups are not equivalent: cached files regenerate, but
 * plugin data is authored content. Only the safe group is preselected —
 * losing a notebook must take a deliberate click.
 */
export const ResetMolvisDialog: React.FC<ResetMolvisDialogProps> = ({
  open,
  onOpenChange,
  onCleared,
}) => {
  const [details, setDetails] = useState<
    Array<{ group: StorageGroup; detail: string }>
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    const groups = storageGroups();
    setSelected(
      new Set(groups.filter((g) => g.tier === "cache").map((g) => g.id)),
    );
    let live = true;
    void describeGroups(groups).then((next) => {
      if (live) setDetails(next);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onConfirm = async () => {
    setBusy(true);
    await clearGroups(storageGroups().filter((g) => selected.has(g.id)));
    onOpenChange(false);
    onCleared();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reset MolVis</DialogTitle>
          <DialogDescription>
            Erase stored data, then restart the viewer. Nothing on disk is
            touched — only what MolVis saved in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-1">
          {details.map(({ group, detail }) => (
            <div
              key={group.id}
              className="flex items-start gap-2 rounded-control px-2 py-1.5 hover:bg-muted/40"
            >
              <Checkbox
                id={`reset-${group.id}`}
                checked={selected.has(group.id)}
                onCheckedChange={() => toggle(group.id)}
                className="mt-0.5"
              />
              {/* Explicit htmlFor: Radix renders a button, so a wrapping
                  label would not reliably associate with it. */}
              <label
                htmlFor={`reset-${group.id}`}
                className="min-w-0 flex-1 cursor-pointer"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm">{group.label}</span>
                  <span className="shrink-0 text-micro text-muted-foreground">
                    {detail}
                  </span>
                </span>
                <span className="block text-micro text-muted-foreground">
                  {TIER_NOTE[group.tier]}
                </span>
              </label>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={busy}>
            {busy ? "Resetting…" : "Reset and restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
