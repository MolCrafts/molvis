/**
 * Dropdown of available `cluster_N` columns for COM / Rg modifiers.
 */

import { listClusterColumns, type Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AUTO = "__auto__";

interface Props {
  app: Molvis | null;
  value: string;
  onChange: (column: string) => void;
  /** Extra columns to offer even if not on the current frame (e.g. upstream Cluster). */
  extraColumns?: string[];
}

export const ClusterMaskSelect: React.FC<Props> = ({
  app,
  value,
  onChange,
  extraColumns = [],
}) => {
  const options = useMemo(() => {
    const fromFrame = app?.system.frame
      ? listClusterColumns(app.system.frame)
      : [];
    const set = new Set<string>([...fromFrame, ...extraColumns]);
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [app, extraColumns, app?.system.frame]);

  return (
    <div className="space-y-1.5">
      <Label className="text-micro">Cluster mask</Label>
      <Select
        value={value || AUTO}
        onValueChange={(v) => onChange(v === AUTO ? "" : v)}
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue placeholder="Auto (latest)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>
            <span className="text-xs">Auto (latest cluster_N)</span>
          </SelectItem>
          {options.map((col) => (
            <SelectItem key={col} value={col}>
              <span className="font-mono text-xs">{col}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
