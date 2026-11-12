import type { SessionItem } from './types';

/** One session row plus the subagents that session dispatched. */
export interface SessionNode {
  session: SessionItem;
  children: SessionNode[];
}

const STATUS_RANK: Record<string, number> = { question: 0, running: 1, error: 2, done: 3 };

function statusRank(session: SessionItem): number {
  return STATUS_RANK[session.status ?? 'done'] ?? 3;
}

/**
 * Group subagent sessions under their durable parent session.
 *
 * A subagent that is active keeps its parent group near the top: a node's rank
 * is the best rank in its whole subtree, and ties fall back to the newest
 * activity in that subtree. Sessions whose parent is not in the live list stay
 * at the top level (still marked as subagents), and malformed lineage falls
 * back to a root instead of looping.
 */
export function buildSessionTree(sessions: SessionItem[]): SessionNode[] {
  const nodes = new Map<string, SessionNode>();
  const ids: string[] = [];
  sessions.forEach((session, index) => {
    const id = session.id || `index-${index}`;
    ids.push(id);
    nodes.set(id, { session, children: [] });
  });

  const parentOf = new Map<string, string>();
  sessions.forEach((session, index) => {
    const parentId = session.parentId || '';
    if (parentId) parentOf.set(ids[index], parentId);
  });

  function createsCycle(id: string, parentId: string): boolean {
    let current = parentId;
    for (let guard = 0; current && guard < ids.length + 1; guard += 1) {
      if (current === id) return true;
      current = parentOf.get(current) || '';
    }
    return false;
  }

  const roots: SessionNode[] = [];
  sessions.forEach((session, index) => {
    const id = ids[index];
    const node = nodes.get(id)!;
    const parentId = session.parentId || '';
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parentId !== id && !createsCycle(id, parentId)) parent.children.push(node);
    else roots.push(node);
  });

  function subtreeRank(node: SessionNode): number {
    let rank = statusRank(node.session);
    for (const child of node.children) rank = Math.min(rank, subtreeRank(child));
    return rank;
  }

  function subtreeActivity(node: SessionNode): number {
    let latest = Number(node.session.lastActiveAt) || 0;
    for (const child of node.children) latest = Math.max(latest, subtreeActivity(child));
    return latest;
  }

  function sortNodes(list: SessionNode[]): void {
    list.sort((a, b) => {
      const byRank = subtreeRank(a) - subtreeRank(b);
      return byRank !== 0 ? byRank : subtreeActivity(b) - subtreeActivity(a);
    });
    for (const node of list) sortNodes(node.children);
  }

  sortNodes(roots);
  return roots;
}
