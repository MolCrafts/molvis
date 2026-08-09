import { ChevronDown } from "lucide-react";
import type React from "react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  title: string;
  /** Free-form, so a caller can set an identifier in a code face. */
  subtitle?: React.ReactNode;
  badge?: string;
  /** Uncontrolled initial open state. Ignored when `open` is set. */
  defaultOpen?: boolean;
  /**
   * Controlled open state. When provided with `onOpenChange`, the section
   * becomes controlled — used by exclusive-accordion panels.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Keep children mounted after first open (collapse is visual only).
   * Use for panels that hold form/sketch state across accordion switches.
   * Closed content is `display: none` so it never peeks under the header.
   */
  keepMounted?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Extra classes on the inner content wrapper (e.g. to make it flex-1). */
  contentClassName?: string;
}

/** Collapsible viewer-inspector section using local type and hover tokens. */
export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  subtitle,
  badge,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  keepMounted = false,
  children,
  className,
  contentClassName,
}) => {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = isControlled ? openProp : uncontrolledOpen;
  // Once opened (or keepMounted path), we may keep the body in the DOM.
  const [everOpened, setEverOpened] = useState(open);
  const contentId = useId();

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }
  };

  // keepMounted: stay in DOM after first open, hide with `hidden` when closed.
  // otherwise: only mount while open (no peek, no leftover min-heights).
  const showBody = open || (keepMounted && everOpened);

  return (
    <section
      className={cn(
        // Default stacked list chrome; callers may replace with card borders.
        !className && "border-b border-border/70",
        open && contentClassName?.includes("flex-1") && "flex min-h-0 flex-col",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full shrink-0 items-center justify-between gap-2 px-2 py-2 text-left transition-colors duration-(--motion-fast) ease-standard hover:bg-interactive"
        onClick={() => setOpen(!open)}
      >
        <div className="min-w-0">
          <div className="text-micro font-semibold tracking-wide uppercase leading-none text-muted-foreground">
            {title}
          </div>
          {subtitle && (
            <div className="mt-1 truncate text-micro text-subtle-foreground">
              {subtitle}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className="rounded-control border border-border bg-muted px-2 py-0 text-micro font-medium text-muted-foreground">
              {badge}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-(--motion-fast) ease-standard",
              !open && "-rotate-90",
            )}
          />
        </div>
      </button>

      {showBody && (
        <div
          id={contentId}
          aria-hidden={!open}
          inert={open ? undefined : true}
          // `hidden` is the only reliable collapse for keepMounted bodies with
          // custom elements / min-heights (grid 0fr still leaked under headers).
          className={cn(
            "min-h-0 overflow-hidden",
            open
              ? cn(
                  contentClassName?.includes("flex-1") &&
                    "flex flex-1 flex-col",
                )
              : "hidden",
          )}
        >
          <div
            className={cn(
              // min-h-0 is required for nested flex + sketch grid to shrink
              // inside narrow drawers instead of overflowing the panel.
              "min-h-0 min-w-0 space-y-2 overflow-hidden px-2 pb-2",
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
      )}
    </section>
  );
};
