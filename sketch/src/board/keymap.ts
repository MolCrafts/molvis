import { isCtrlOrMeta } from "@molcrafts/molvis-core/platform";
export type SketchAction =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "cancel" }
  | { type: "bondOrder"; order: 1 | 2 | 3 }
  | { type: "element"; symbol: string }
  | { type: "panHold"; down: boolean };

const ELEMENT_KEYS: Record<string, string> = {
  b: "B",
  c: "C",
  n: "N",
  o: "O",
  h: "H",
  p: "P",
  s: "S",
  f: "F",
  i: "I",
};

/**
 * Resolve keyboard event to a sketch action (pure).
 */
export function resolveKeymap(e: {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): SketchAction | null {
  const mod = isCtrlOrMeta({
    ctrlKey: !!e.ctrlKey,
    metaKey: !!e.metaKey,
  });
  if (mod && e.key.toLowerCase() === "z" && e.shiftKey) return { type: "redo" };
  if (mod && e.key.toLowerCase() === "z") return { type: "undo" };
  if (mod && e.key.toLowerCase() === "y") return { type: "redo" };
  if (e.key === "Delete" || e.key === "Backspace") return { type: "delete" };
  if (e.key === "Escape") return { type: "cancel" };
  if (e.key === "1") return { type: "bondOrder", order: 1 };
  if (e.key === "2") return { type: "bondOrder", order: 2 };
  if (e.key === "3") return { type: "bondOrder", order: 3 };
  if (e.key === " ") return { type: "panHold", down: true };

  // two-char elements: Cl, Br via sequential is board-level; single keys:
  const sym = ELEMENT_KEYS[e.key.toLowerCase()];
  if (sym) return { type: "element", symbol: sym };
  return null;
}
