import {
  DataSource,
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Modifier,
  type PipelineEntry,
  SelectModifier,
  Session,
} from "@molcrafts/molvis-stage";

/**
 * Ownership is a modifier-side field — a {@link DataSource} / {@link Session}
 * is never owned by another entry, so it is always a tree root.
 */
function ownerOf(entry: PipelineEntry): string | null {
  if (entry instanceof DataSource || entry instanceof Session) return null;
  return (entry as Modifier).sourceOwnerId ?? null;
}

export interface TreeNode {
  entry: PipelineEntry;
  children: TreeNode[];
  depth: number;
}

/**
 * Build a tree from a flat modifier array using sourceOwnerId.
 * Roots have sourceOwnerId === null. Children are grouped under their source.
 * Array order is preserved within each group.
 */
export function buildTree(entries: readonly PipelineEntry[]): TreeNode[] {
  const childrenByParent = new Map<string, PipelineEntry[]>();
  const roots: PipelineEntry[] = [];

  for (const entry of entries) {
    const owner = ownerOf(entry);
    if (owner === null) {
      roots.push(entry);
    } else {
      const siblings = childrenByParent.get(owner) ?? [];
      siblings.push(entry);
      childrenByParent.set(owner, siblings);
    }
  }

  function buildNodes(mods: PipelineEntry[], depth: number): TreeNode[] {
    return mods.map((mod) => {
      const kids = childrenByParent.get(mod.id) ?? [];
      return {
        entry: mod,
        children: buildNodes(kids, depth + 1),
        depth,
      };
    });
  }

  return buildNodes(roots, 0);
}

/**
 * Flatten a tree to display order using DFS.
 * For each node, output the node. If the node is in expandedIds AND has
 * children, recursively output children. Non-expanded nodes skip children.
 */
export function flattenTree(
  roots: TreeNode[],
  expandedIds: Set<string>,
): TreeNode[] {
  const result: TreeNode[] = [];

  function visit(nodes: TreeNode[]): void {
    for (const node of nodes) {
      result.push(node);
      if (node.children.length > 0 && expandedIds.has(node.entry.id)) {
        visit(node.children);
      }
    }
  }

  visit(roots);
  return result;
}

/**
 * Get all descendants of a modifier (for cascade delete confirmation).
 * Returns descendants in depth-first order.
 */
export function getDescendants(
  modifierId: string,
  entries: readonly PipelineEntry[],
): PipelineEntry[] {
  const childrenByParent = new Map<string, PipelineEntry[]>();
  for (const entry of entries) {
    const owner = ownerOf(entry);
    if (owner !== null) {
      const siblings = childrenByParent.get(owner) ?? [];
      siblings.push(entry);
      childrenByParent.set(owner, siblings);
    }
  }

  const result: PipelineEntry[] = [];
  function collect(sourceOwnerId: string): void {
    const kids = childrenByParent.get(sourceOwnerId) ?? [];
    for (const kid of kids) {
      result.push(kid);
      collect(kid.id);
    }
  }

  collect(modifierId);
  return result;
}

/**
 * Get selection-producing modifiers that could be valid scopes.
 * for a given modifier. Excludes the modifier itself.
 */
export function getAvailableParents(
  modifierId: string,
  entries: readonly PipelineEntry[],
): Modifier[] {
  return entries.filter(
    (e): e is Modifier =>
      !(e instanceof DataSource) &&
      e.id !== modifierId &&
      isSelectionProducer(e as Modifier),
  );
}

/**
 * Get a human-readable label for a selection-producing modifier.
 */
export function getSelectionLabel(mod: Modifier): string {
  if (mod instanceof SelectModifier) {
    return mod.name;
  }
  if (mod instanceof ExpressionSelectionModifier) {
    if (mod.selectionName) return mod.selectionName;
    return mod.expression ? `Expr: ${mod.expression}` : "Expression (empty)";
  }
  return mod.name;
}
