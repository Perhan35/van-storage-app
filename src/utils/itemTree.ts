// Items can be stored inside other items (Sac > Trousse > Brosse à dent).
// These helpers work on a flat list of items (typically one zone's) linked by
// parent_id. They are pure, so the repository can reuse them inside a single
// withDb callback and the screens can reuse them for optimistic updates.

// Levels counted from the zone: Sac (1) > Trousse (2) > Brosse à dent (3).
export const MAX_ITEM_DEPTH = 3;

type TreeNode = { id: string; parent_id: string | null };

export function indexById<T extends TreeNode>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

// parent id → direct children, in the order the items were given. Children
// whose parent isn't in the list are treated as top-level (see isRoot).
export function childrenByParent<T extends TreeNode>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (!item.parent_id) continue;
    const list = map.get(item.parent_id);
    if (list) list.push(item);
    else map.set(item.parent_id, [item]);
  }
  return map;
}

// Ancestors of an item, closest first (Trousse, then Sac). Stops on a cycle
// or a parent missing from the list, so bad data can never loop forever.
export function ancestorsOf<T extends TreeNode>(id: string, byId: Map<string, T>): T[] {
  const result: T[] = [];
  const seen = new Set<string>([id]);
  let parentId = byId.get(id)?.parent_id ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    result.push(parent);
    seen.add(parentId);
    parentId = parent.parent_id;
  }
  return result;
}

// 1 for an item sitting directly in its zone.
export function depthOf<T extends TreeNode>(id: string, byId: Map<string, T>): number {
  return ancestorsOf(id, byId).length + 1;
}

// Every item stored inside this one, at any level.
export function descendantsOf<T extends TreeNode>(id: string, children: Map<string, T[]>): T[] {
  const result: T[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
    stack.push(...(children.get(node.id) ?? []));
  }
  return result;
}

// Levels this item occupies itself: 1 for an item with nothing inside it, 2
// for a Trousse holding a Brosse, 3 for a Sac holding that Trousse.
export function subtreeHeight<T extends TreeNode>(
  id: string,
  children: Map<string, T[]>,
  seen: Set<string> = new Set()
): number {
  if (seen.has(id)) return 1;
  seen.add(id);
  let max = 0;
  for (const child of children.get(id) ?? []) {
    max = Math.max(max, subtreeHeight(child.id, children, seen));
  }
  return max + 1;
}

// Whether `itemId` (with everything inside it) may be stored inside
// `targetId` without going past MAX_ITEM_DEPTH or into itself.
export function canNestInto<T extends TreeNode>(itemId: string, targetId: string, items: T[]): boolean {
  if (itemId === targetId) return false;
  const byId = indexById(items);
  if (!byId.has(targetId)) return false;
  const targetAncestors = ancestorsOf(targetId, byId);
  if (targetAncestors.some((a) => a.id === itemId)) return false;
  const children = childrenByParent(items);
  return targetAncestors.length + 1 + subtreeHeight(itemId, children) <= MAX_ITEM_DEPTH;
}

// Whether a brand-new (empty) item can be added inside `targetId`.
export function canAddInto<T extends TreeNode>(targetId: string, items: T[]): boolean {
  const byId = indexById(items);
  return byId.has(targetId) && depthOf(targetId, byId) < MAX_ITEM_DEPTH;
}

export type ParentOption = { id: string; name: string; depth: number };

// The places an item can be stored in, in tree order (each one followed by
// what's inside it) so a picker can show them indented. `movingItemId` is the
// item being moved — null when picking a parent for a brand-new item.
export function parentOptions<T extends TreeNode & { name: string }>(
  items: T[],
  movingItemId: string | null
): ParentOption[] {
  const byId = indexById(items);
  const children = childrenByParent(items);
  const allowed = (id: string) =>
    movingItemId ? canNestInto(movingItemId, id, items) : canAddInto(id, items);
  const result: ParentOption[] = [];
  const visit = (node: T, depth: number) => {
    if (node.id === movingItemId) return; // nor anything inside it
    if (allowed(node.id)) result.push({ id: node.id, name: node.name, depth });
    for (const child of sortByName(children.get(node.id) ?? [])) visit(child, depth + 1);
  };
  for (const root of sortByName(items.filter((i) => isRoot(i, byId)))) visit(root, 1);
  return result;
}

function sortByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function isRoot<T extends TreeNode>(item: T, byId: Map<string, T>): boolean {
  return !item.parent_id || !byId.has(item.parent_id);
}

// Checklist rule: checking an item checks everything inside it, and an item
// whose contents are all checked counts as checked itself (one unchecked
// thing inside unchecks it). Returns the new list, keeping the identity of
// every untouched item so memoized rows don't re-render.
export function applyChecked<T extends TreeNode & { checked: number }>(
  items: T[],
  itemId: string,
  checked: boolean
): T[] {
  const children = childrenByParent(items);
  const byId = indexById(items);
  const value = checked ? 1 : 0;
  const next = new Map<string, number>();
  next.set(itemId, value);
  for (const d of descendantsOf(itemId, children)) next.set(d.id, value);
  const valueOf = (i: T) => next.get(i.id) ?? i.checked;
  for (const ancestor of ancestorsOf(itemId, byId)) {
    const kids = children.get(ancestor.id) ?? [];
    next.set(ancestor.id, kids.every((k) => valueOf(k) === 1) ? 1 : 0);
  }
  return items.map((i) => {
    const v = next.get(i.id);
    return v === undefined || v === i.checked ? i : { ...i, checked: v };
  });
}
