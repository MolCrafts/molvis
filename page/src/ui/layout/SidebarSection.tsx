import { ChevronDown } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  title: string;
  /** Free-form, so a caller can set an identifier in a code face. */
  subtitle?: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Extra classes on the inner content wrapper (e.g. to make it flex-1). */
  contentClassName?: string;
}

/**
 * Collapsible sidebar block. Typography matches molexp panel headers
 * (`text-[11px] uppercase tracking-wide muted`) and row hover uses the same
 * `muted/40` wash as molexp trees/tables.
 */
export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  subtitle,
  badge,
  defaultOpen = true,
  children,
  className,
  contentClassName,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn("border-b border-border/70", className)}>
      <button
        type="button"
        className="w-full px-2 py-1.5 text-left flex items-center justify-between gap-1.5 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wide uppercase leading-none text-muted-foreground">
            {title}
          </div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
              {subtitle}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {badge && (
            <span className="px-1.5 py-0 rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </div>
      </button>

      {open && (
        <div className={cn("px-2 pb-2 space-y-1.5", contentClassName)}>
          {children}
        </div>
      )}
    </section>
  );
};
