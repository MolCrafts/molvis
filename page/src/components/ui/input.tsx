import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-control w-full min-w-0 rounded-control border border-input bg-transparent px-3 py-1 text-body-lg outline-none transition-colors duration-(--motion-fast) ease-standard file:inline-flex file:h-control-compact file:border-0 file:bg-transparent file:text-body file:font-medium placeholder:text-muted-foreground selection:bg-accent selection:text-accent-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
