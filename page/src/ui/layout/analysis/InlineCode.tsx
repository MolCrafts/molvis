import type React from "react";
import { Code } from "@/components/ui/code";

/**
 * Render backtick-marked identifiers in a code face.
 *
 * Core phrases its requirement reasons as plain text with markdown-style
 * backticks (`` needs `vx`, `vy`, `vz` on the `atoms` block ``) so the same
 * string can serve a rich renderer and a plain-text `title` tooltip. This
 * splits on those markers; an unpaired backtick is left as literal text.
 *
 * `wrap="anywhere"`: these land in ~240px alerts, where a long identifier would
 * otherwise push the alert into horizontal overflow.
 */
export const InlineCode: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split("`").map((part, index) =>
      // Odd segments sit between a pair of backticks.
      index % 2 === 1 ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: segment position is its identity
        <Code key={index} wrap="anywhere">
          {part}
        </Code>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: segment position is its identity
        <span key={index}>{part}</span>
      ),
    )}
  </>
);
