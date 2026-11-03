export type AvailableModifier = {
  entry: { name: string; category: string };
  applicable: boolean;
};

/**
 * First-level add-menu groups: one-word nouns, Title Case.
 *
 * Registry categories stay OVITO-shaped (`Coloring`, `Structure
 * identification`) so plugins keep registering against that key.
 * The menu maps them onto this shorter noun list.
 */
export const ADD_MENU_GROUPS = [
  "Source",
  "Selection",
  "Modification",
  "Color",
  "Structure",
  "Visualization",
  "Analysis",
  "Other",
] as const;

export type AddMenuGroup = (typeof ADD_MENU_GROUPS)[number];

const REGISTRY_TO_GROUP: Record<string, AddMenuGroup> = {
  Selection: "Selection",
  Modification: "Modification",
  Coloring: "Color",
  "Structure identification": "Structure",
  Visualization: "Visualization",
  Analysis: "Analysis",
};

/** Sentence-case outliers; registry `name` stays the identity key. */
const ITEM_LABELS: Record<string, string> = {
  "Expression Select": "Expression select",
  "Clear Selection": "Clear selection",
  "Invert Selection": "Invert selection",
  "Select Type": "Select type",
  "Expand Selection": "Expand selection",
  "Hide Selection": "Hide selection",
  "Delete Selected": "Delete selected",
  "Hide Hydrogens": "Hide hydrogens",
  "Color by Property": "Color by property",
  "Color by Type": "Color by type",
  "Assign Color": "Assign color",
};

export const WRAP_PBC_ID = "flag:wrap-pbc";
export const WRAP_PBC_LABEL = "Wrap PBC";

export type PipelineAddKind =
  | "open"
  | "add-source"
  | "extend"
  | "stream"
  | "modifier"
  | "wrap";

export interface PipelineAddItem {
  id: string;
  label: string;
  group: AddMenuGroup;
  kind: PipelineAddKind;
  keywords: readonly string[];
  disabled: boolean;
  /** Registry identity for modifier rows. */
  modifierName?: string;
  checked?: boolean;
}

export function addMenuGroup(category: string): AddMenuGroup {
  return REGISTRY_TO_GROUP[category] ?? "Other";
}

export function modifierMenuLabel(name: string): string {
  return ITEM_LABELS[name] ?? name;
}

export function buildPipelineAddItems(args: {
  modifiers: readonly AvailableModifier[];
  hasSources: boolean;
  wrapEnabled: boolean;
}): PipelineAddItem[] {
  const items: PipelineAddItem[] = [
    {
      id: "source:open",
      label: args.hasSources ? "Replace…" : "Open…",
      group: "Source",
      kind: "open",
      keywords: ["file", "open", "load", "replace", "source"],
      disabled: false,
    },
    {
      id: "source:add",
      label: "Add source…",
      group: "Source",
      kind: "add-source",
      keywords: ["file", "add", "source", "augment", "stack"],
      disabled: !args.hasSources,
    },
    {
      id: "source:extend",
      label: "Extend trajectory…",
      group: "Source",
      kind: "extend",
      keywords: ["file", "extend", "concat", "append", "atoms"],
      disabled: !args.hasSources,
    },
    {
      id: "source:stream",
      label: "Stream…",
      group: "Source",
      kind: "stream",
      keywords: ["stream", "websocket", "live", "ws"],
      disabled: false,
    },
  ];

  const wrapItem: PipelineAddItem = {
    id: WRAP_PBC_ID,
    label: WRAP_PBC_LABEL,
    group: "Modification",
    kind: "wrap",
    keywords: ["wrap", "pbc", "periodic", "boundary", "fold", "cell"],
    disabled: false,
    checked: args.wrapEnabled,
  };

  let insertedWrap = false;
  for (const { entry, applicable } of args.modifiers) {
    items.push({
      id: `modifier:${entry.name}`,
      label: modifierMenuLabel(entry.name),
      group: addMenuGroup(entry.category),
      kind: "modifier",
      keywords: [entry.name, entry.category],
      disabled: !applicable,
      modifierName: entry.name,
    });
    if (entry.name === "Slice") {
      items.push(wrapItem);
      insertedWrap = true;
    }
  }
  if (!insertedWrap) items.push(wrapItem);
  return items;
}

export function filterPipelineAddItems(
  items: readonly PipelineAddItem[],
  query: string,
): PipelineAddItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    const hay = [item.label, item.group, item.modifierName, ...item.keywords]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function groupPipelineAddItems(
  items: readonly PipelineAddItem[],
): Array<{ group: AddMenuGroup; items: PipelineAddItem[] }> {
  return ADD_MENU_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);
}
