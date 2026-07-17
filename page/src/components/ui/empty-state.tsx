import type { JSX, ReactNode } from "react";

export type EmptyStateDensity = "default" | "compact" | "inline";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  density?: EmptyStateDensity;
  className?: string;
}

const CONTAINER: Record<EmptyStateDensity, string> = {
  default: "flex flex-col items-center gap-2 py-12 text-center",
  compact: "flex flex-col items-center gap-2 px-3 py-8 text-center",
  inline: "px-2 py-1.5 text-left",
};

const TITLE: Record<EmptyStateDensity, string> = {
  default: "text-sm text-muted-foreground",
  compact: "text-xs text-muted-foreground",
  inline: "text-xs text-muted-foreground",
};

const DESCRIPTION: Record<EmptyStateDensity, string> = {
  default: "text-xs text-muted-foreground/70",
  compact: "text-[11px] text-muted-foreground/70",
  inline: "text-[11px] text-muted-foreground/70",
};

/** Empty placeholder — same density ladder as molexp `EmptyState`. */
export const EmptyState = ({
  title,
  description,
  action,
  icon,
  density = "default",
  className,
}: EmptyStateProps): JSX.Element => {
  return (
    <div className={[CONTAINER[density], className].filter(Boolean).join(" ")}>
      {icon && <div className="text-muted-foreground/40">{icon}</div>}
      <p className={TITLE[density]}>{title}</p>
      {description && <p className={DESCRIPTION[density]}>{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};
