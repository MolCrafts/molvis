import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewerActionPurpose = "commit" | "dismiss" | "remove";

type BaseButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant" | "size"
>;

export interface ViewerActionProps extends BaseButtonProps {
  /** The user-facing consequence of the action, never a visual color choice. */
  purpose?: ViewerActionPurpose;
}

const PURPOSE_VARIANTS = {
  commit: "default",
  dismiss: "outline",
  remove: "destructive",
} as const;

/**
 * Compact text action for MolVis dialogs, inspectors, and tool surfaces.
 *
 * Feature code describes the action's consequence; this component owns the
 * shadcn variant and viewer density.
 */
export const ViewerAction = React.forwardRef<
  React.ElementRef<typeof Button>,
  ViewerActionProps
>(({ purpose = "commit", className, ...props }, ref) => (
  <Button
    ref={ref}
    variant={PURPOSE_VARIANTS[purpose]}
    size="sm"
    className={cn("[&_svg]:size-4", className)}
    {...props}
  />
));

ViewerAction.displayName = "ViewerAction";
