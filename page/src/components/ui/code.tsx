import type * as React from "react";

import { cn } from "@/lib/utils";

function Code({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="code"
      className={cn(
        "relative rounded-control bg-muted px-1 font-mono font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Code };
