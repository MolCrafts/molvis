import type React from "react";

/** Label-over-control stack for narrow analysis sidebars. */
export function ParamStack({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
