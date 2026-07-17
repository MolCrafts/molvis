import { GripVerticalIcon } from "lucide-react";
import type * as React from "react";
import {
  Group as ResizableGroup,
  Panel as ResizablePanelPrimitive,
  Separator as ResizableSeparator,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizableGroup>) {
  return (
    <ResizableGroup
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePanelPrimitive>) {
  return <ResizablePanelPrimitive data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizableSeparator> & {
  withHandle?: boolean;
}) {
  return (
    <ResizableSeparator
      data-slot="resizable-handle"
      className={cn(
        // Handle chrome matches molexp (1px border rail + optional grip).
        // orientation hooks stay so horizontal groups still flip correctly.
        "bg-border focus-visible:ring-ring relative flex w-px shrink-0 items-center justify-center cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizableSeparator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
