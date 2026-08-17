import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ToolButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size" | "aria-label" | "aria-pressed" | "title"
>;

export interface ViewerToolButtonProps extends ToolButtonProps {
  label: string;
  selected?: boolean;
  tooltip?: React.ReactNode;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
}

/**
 * Compact viewer tool with an accessible name, cross-input tooltip, and
 * unmistakable accent-filled active state.
 */
export const ViewerToolButton = React.forwardRef<
  React.ElementRef<typeof Button>,
  ViewerToolButtonProps
>(
  (
    {
      label,
      selected,
      tooltip = label,
      tooltipSide = "bottom",
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={selected ? "default" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={selected === undefined ? undefined : selected}
          data-active={selected ? "true" : "false"}
          className={cn(
            "size-control-compact [&_svg]:size-4",
            selected &&
              "ring-2 ring-accent-foreground/80 ring-inset hover:bg-accent-hover",
            className,
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  ),
);

ViewerToolButton.displayName = "ViewerToolButton";
