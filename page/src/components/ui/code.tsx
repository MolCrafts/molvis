import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Inline code, following shadcn's typography `inline-code` recipe.
 *
 * Sizing is `em`-relative rather than shadcn's fixed `text-sm`, so the same
 * component reads correctly inside the sidebar's 10px labels and inside body
 * copy. Everything else — the muted surface, the mono face — comes from the
 * theme, not from ad-hoc classes at the call site.
 */
function Code({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="code"
      className={cn(
        "relative rounded bg-muted px-[0.3em] py-[0.1em] font-mono text-[0.9em] font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Code };
