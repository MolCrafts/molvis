import type React from "react";

/**
 * Label-over-control stack for narrow compute sidebars.
 *
 * - `unit` sits on the label row (never inside the control)
 * - `caption` is a single muted line under the control (auto estimates, hints)
 */
export function ParamStack({
  label,
  unit,
  caption,
  children,
}: {
  label: string;
  unit?: string;
  caption?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="truncate text-micro text-muted-foreground">
          {label}
        </span>
        {unit ? (
          <span className="shrink-0 text-micro text-subtle-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {children}
      {caption ? (
        <span className="truncate font-mono text-micro tabular-nums text-subtle-foreground">
          {caption}
        </span>
      ) : null}
    </div>
  );
}
