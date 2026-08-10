import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Mono text for machine syntax (coordinates, digests, paths).
 * `inline` for prose/table cells; `block` for copyable multi-line blobs.
 */
const codeVariants = cva("rounded-control bg-muted font-mono text-foreground", {
  variants: {
    variant: {
      inline: "px-1 py-px font-medium",
      block: "block w-full overflow-x-auto px-2 py-1.5",
    },
    wrap: {
      none: "whitespace-nowrap",
      anywhere: "[overflow-wrap:anywhere]",
    },
  },
  defaultVariants: {
    variant: "inline",
    wrap: "none",
  },
});

function Code({
  className,
  variant,
  wrap,
  ...props
}: React.ComponentProps<"code"> & VariantProps<typeof codeVariants>) {
  return (
    <code
      data-slot="code"
      className={cn(codeVariants({ variant, wrap }), className)}
      {...props}
    />
  );
}

export { Code, codeVariants };
