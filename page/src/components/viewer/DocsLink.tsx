/**
 * Borderless handbook link — the single style for “go read molpy/molvis docs”
 * guidance. No card, no border, no background pill: just text that reads as a
 * link. Prefer this over in-panel lectures.
 */

import { ExternalLink } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DocsLinkProps {
  href: string;
  children: ReactNode;
  /** Hide the external-link glyph (default shows a subtle one). */
  hideIcon?: boolean;
  className?: string;
}

/**
 * Flat external docs link. Opens in a new tab. Use for molpy handbook pointers
 * under modifiers, compute, and optimizer — not for in-app navigation.
 */
export function DocsLink({
  href,
  children,
  hideIcon = false,
  className,
}: DocsLinkProps): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 border-0 bg-transparent p-0",
        "text-micro font-medium text-accent/85 no-underline",
        "underline-offset-2 transition-colors duration-(--motion-fast) ease-standard",
        "hover:text-accent hover:underline",
        "focus-visible:outline-none focus-visible:text-accent focus-visible:underline",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {!hideIcon ? (
        <ExternalLink
          className="size-2.5 shrink-0 opacity-55"
          aria-hidden
          strokeWidth={2}
        />
      ) : null}
    </a>
  );
}
