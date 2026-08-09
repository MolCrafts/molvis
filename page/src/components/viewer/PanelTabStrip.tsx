import type React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PanelTabItem {
  value: string;
  label: string;
  icon: React.ReactNode;
}

export interface PanelTabStripProps {
  items: PanelTabItem[];
  /** Accessible name of the strip itself, e.g. "Viewer modes". */
  label: string;
  disabled?: boolean;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  className?: string;
}

/**
 * Glyph-only tab strip shared by both side panels.
 *
 * Tabs **share the full header width evenly** (`flex-1` each) so a strip of
 * two and a strip of six still read as one band — never packed to the left
 * with a dead gap on the right. Wording lives in the tooltip / accessible
 * name; the active tab is an accent glyph over a hairline underline.
 */
export const PanelTabStrip: React.FC<PanelTabStripProps> = ({
  items,
  label,
  disabled = false,
  tooltipSide = "bottom",
  className,
}) => {
  return (
    <TabsList
      variant="line"
      aria-label={label}
      className={cn(
        // Full-width row; each trigger takes an equal share.
        "flex h-full w-full min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0",
        "group-data-[orientation=horizontal]/tabs:h-full",
        className,
      )}
    >
      {items.map((item) => (
        <Tooltip key={item.value}>
          <TooltipTrigger asChild>
            <TabsTrigger
              value={item.value}
              aria-label={item.label}
              disabled={disabled}
              className={cn(
                // Equal columns across the band (overrides base flex-1 + px).
                "h-full min-w-0 flex-1 basis-0 self-stretch rounded-none border-0 bg-transparent px-0 shadow-none",
                "text-muted-foreground hover:text-foreground",
                "focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
                "focus-visible:bg-interactive/60",
                // TooltipTrigger clobbers data-state — style via aria-selected.
                "aria-selected:text-accent",
                "group-data-[orientation=horizontal]/tabs:after:inset-x-2 group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[orientation=horizontal]/tabs:after:h-px",
                "after:bg-accent aria-selected:after:opacity-100",
              )}
            >
              <span
                className="flex size-4 items-center justify-center [&_svg]:size-4"
                aria-hidden
              >
                {item.icon}
              </span>
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{item.label}</TooltipContent>
        </Tooltip>
      ))}
    </TabsList>
  );
};
