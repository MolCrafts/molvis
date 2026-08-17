/**
 * Shared reading of the compute-panel empty-state contract.
 *
 * `.claude/notes/compute-form-design.md`: **Empty states: title only (`No RDF
 * yet`, `No MSD yet`). No tutorial paragraphs.** Each compute panel keeps its
 * own test file (one module → its own tests); only this DOM reading is shared,
 * so a panel test never renders a sibling panel.
 */

export interface EmptyStateProbe {
  /** First paragraph of the empty state — its title. */
  title: string;
  /** Every later paragraph in the same empty state; must be empty. */
  descriptions: string[];
}

function textOf(node: Element): string {
  return (node.textContent ?? "").trim();
}

/**
 * Read the panel's empty state. `EmptyState` renders
 * `<div>{icon}<p>title</p>{description && <p>…</p>}</div>`, so the empty state
 * is located by its title paragraph and its body is that paragraph's parent.
 *
 * A run bar's `summary` is also a paragraph and may also open with "No …"
 * (e.g. PCA's `No frame labels available`), so candidates whose container
 * holds a control are rejected — an empty state carries copy, not buttons.
 *
 * Returns `null` when the panel renders no empty state at all.
 */
export function readEmptyState(root: ParentNode): EmptyStateProbe | null {
  const title = Array.from(root.querySelectorAll("p")).find((paragraph) => {
    if (!/^No\b/i.test(textOf(paragraph))) return false;
    return paragraph.parentElement?.querySelector("button") == null;
  });
  const body = title?.parentElement;
  if (!title || !body) return null;
  const paragraphs = Array.from(body.querySelectorAll("p")).map(textOf);
  return { title: textOf(title), descriptions: paragraphs.slice(1) };
}

/** Which of the panel's current tutorial strings are still rendered. */
export function tutorialCopyIn(
  root: ParentNode,
  banned: readonly string[],
): string[] {
  const rendered = (root.textContent ?? "").replace(/\s+/g, " ");
  return banned.filter((phrase) => rendered.includes(phrase));
}
