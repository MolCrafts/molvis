import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type React from "react";

interface ScalarSliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Optional formatter for the readout shown next to the label. */
  format?: (value: number) => string;
  /** Called for both range and number-input changes; only the final
   *  pipeline trigger is the caller's responsibility. */
  onPreview: (value: number) => void;
  /** Called once on commit (range release / number-input blur or enter)
   *  — use this to trigger a pipeline run. */
  onCommit: (value: number) => void;
  /** Right-side accessory (e.g. the bond panel's "reset to default"). */
  accessory?: React.ReactNode;
}

/**
 * Sidebar slider+number-input pair shared by `Draw{Atom,Bond,Box}Modifier`
 * panels. Drag preview is local-only; the pipeline runs once when the
 * user releases the slider or commits the number input — see CLAUDE.md
 * note about avoiding per-pixel pipeline runs during slider drag.
 */
export const ScalarSliderRow: React.FC<ScalarSliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  format,
  onPreview,
  onCommit,
  accessory,
}) => {
  const handleParse = (raw: string): number | null => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    if (numeric < min || numeric > max) return null;
    return numeric;
  };

  const handlePreview = (raw: string) => {
    const numeric = handleParse(raw);
    if (numeric === null || numeric === value) return;
    onPreview(numeric);
  };

  const handleCommit = (raw: string) => {
    const numeric = handleParse(raw);
    if (numeric === null) return;
    onCommit(numeric);
  };

  const display = format ? format(value) : value.toFixed(2);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <Label className="text-xs font-semibold">{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono">
            {display}
          </span>
          {accessory}
        </div>
      </div>
      <div className="flex gap-1.5 items-center">
        <Input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handlePreview(e.target.value)}
          onPointerUp={(e) =>
            handleCommit((e.target as HTMLInputElement).value)
          }
          onKeyUp={(e) => handleCommit((e.target as HTMLInputElement).value)}
          className="h-6"
        />
        <Input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(e) => handlePreview(e.target.value)}
          onBlur={(e) => handleCommit(e.target.value)}
          className="w-16 h-7 px-2 text-xs"
        />
      </div>
    </div>
  );
};
