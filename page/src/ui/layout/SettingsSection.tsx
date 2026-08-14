/**
 * Settings section primitives (SettingsSection + SettingsRow).
 *
 * Domain-free block — shared via molcrafts-ui registry.
 */

import type { JSX, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  /** Anchor id for left-nav scroll targets. */
  id?: string;
  title: string;
  /** Right of the title (status badge, count, …). */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
}

/**
 * Functional group inside Settings — title chrome + content stack.
 */
export function SettingsSection({
  id,
  title,
  trailing,
  children,
  className,
  description,
}: SettingsSectionProps): JSX.Element {
  return (
    <section
      id={id}
      className={cn("scroll-mt-3 space-y-3", className)}
      data-settings-section={id}
    >
      <header>
        <div className="flex items-center justify-between gap-2">
          {description ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
              </TooltipTrigger>
              <TooltipContent side="right">{description}</TooltipContent>
            </Tooltip>
          ) : (
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
          )}
          {trailing}
        </div>
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** One labeled control row used across settings sections. */
export function SettingsRow({
  label,
  htmlFor,
  children,
  className,
  tooltip,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  tooltip?: ReactNode;
}): JSX.Element {
  const labelNode = tooltip ? (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <label
          htmlFor={htmlFor}
          className="shrink-0 cursor-help text-micro text-muted-foreground"
        >
          {label}
        </label>
      </TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    <label
      htmlFor={htmlFor}
      className="shrink-0 text-micro text-muted-foreground"
    >
      {label}
    </label>
  );

  return (
    <div
      className={cn(
        "flex min-h-control-compact items-center justify-between gap-3 rounded-control px-0.5",
        className,
      )}
    >
      {labelNode}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}
