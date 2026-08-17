import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type BaseButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size" | "children" | "aria-label" | "title" | "aria-pressed"
>;

export interface ViewerIconActionProps extends BaseButtonProps {
  icon: React.ReactNode;
  label: string;
  selected?: boolean;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
}

/**
 * MolVis icon action with a mandatory accessible name, tooltip, and fixed
 * compact hit geometry.
 */
export const ViewerIconAction = React.forwardRef<
  React.ElementRef<typeof Button>,
  ViewerIconActionProps
>(
  (
    { icon, label, selected, tooltipSide = "bottom", className, ...props },
    ref,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={selected ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={selected === undefined ? undefined : selected}
          className={cn("size-control-compact [&_svg]:size-4", className)}
          {...props}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  ),
);

ViewerIconAction.displayName = "ViewerIconAction";
