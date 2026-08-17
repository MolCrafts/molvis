import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BaseButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size" | "aria-pressed"
>;

export interface ViewerToggleActionProps extends BaseButtonProps {
  selected: boolean;
}

/** A compact, text-labelled toggle whose selected styling stays product-local. */
export const ViewerToggleAction = React.forwardRef<
  React.ElementRef<typeof Button>,
  ViewerToggleActionProps
>(({ selected, className, ...props }, ref) => (
  <Button
    ref={ref}
    variant={selected ? "secondary" : "ghost"}
    size="sm"
    aria-pressed={selected}
    className={cn("[&_svg]:size-4", className)}
    {...props}
  />
));

ViewerToggleAction.displayName = "ViewerToggleAction";
