import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium outline-none transition-colors duration-(--motion-fast) ease-standard disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent-hover",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-status-failed-hover focus-visible:ring-destructive/30",
        outline:
          "border border-input bg-transparent hover:bg-interactive hover:text-interactive-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-interactive hover:text-interactive-foreground",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        /* 32px default · 28px compact · 36px comfortable (constitution §2) */
        default: "h-control px-4 has-[>svg]:px-3",
        sm: "h-control-compact gap-1 px-3 has-[>svg]:px-2",
        lg: "h-control-comfortable px-6 has-[>svg]:px-4",
        content: "h-auto min-w-0 shrink whitespace-normal",
        icon: "size-control",
        "icon-sm": "size-control-compact",
        "icon-lg": "size-control-comfortable",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      // Bare <button> defaults to type="submit"; only set type for real buttons.
      {...(asChild ? {} : { type: "button" as const })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
