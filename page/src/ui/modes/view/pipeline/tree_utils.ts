import {
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Modifier,
  SelectModifier,
} from "@molvis/core";

export interface TreeNode {
  modifier: Modifier;
  children: TreeNode[];
  depth: number;
}

/**
 * Build a tree from a flat modifier array using sourceOwnerId.
 * Roots have sourceOwnerId === null. Children are grouped under their source.
 * Array order is preserved within each group.
 */
export function buildTree(modifiers: readonly Modifier[]): TreeNode[] {
  const childrenByParent = new Map<string, Modifier[]>();
  const roots: Modifier[] = [];

  for (const mod of modifiers) {
    if (mod.sourceOwnerId === null) {
      roots.push(mod);
    } else {
      const siblings = childrenByParent.get(mod.sourceOwnerId) ?? [];
      siblings.push(mod);
      childrenByParent.set(mod.sourceOwnerId, siblings);
    }
  }

  function buildNodes(mods: Modifier[], depth: number): TreeNode[] {
    return mods.map((mod) => {
      const kids = childrenByParent.get(mod.id) ?? [];
      return {
        modifier: mod,
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
      if (node.children.length > 0 && expandedIds.has(node.modifier.id)) {
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
  modifiers: readonly Modifier[],
): Modifier[] {
  const childrenByParent = new Map<string, Modifier[]>();
  for (const mod of modifiers) {
    if (mod.sourceOwnerId !== null) {
      const siblings = childrenByParent.get(mod.sourceOwnerId) ?? [];
      siblings.push(mod);
      childrenByParent.set(mod.sourceOwnerId, siblings);
    }
  }

  const result: Modifier[] = [];
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
  modifiers: readonly Modifier[],
): Modifier[] {
  return modifiers.filter(
    (mod) => mod.id !== modifierId && isSelectionProducer(mod),
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
