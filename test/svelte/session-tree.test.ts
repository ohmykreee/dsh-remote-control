import { describe, expect, it } from 'vitest';
import { buildSessionTree } from '../../src/svelte/lib/session-tree.ts';
import type { SessionItem } from '../../src/svelte/lib/types.ts';

function item(id: string, extra: Partial<SessionItem> = {}): SessionItem {
  return { id, ...extra };
}

describe('buildSessionTree', () => {
  it('builds an empty tree from an empty list', () => {
    expect(buildSessionTree([])).toEqual([]);
  });

  it('groups subagents under their parent and sorts the children', () => {
    const tree = buildSessionTree([
      item('child-b', { parentId: 'root', status: 'running', lastActiveAt: 2 }),
      item('root', { status: 'done', lastActiveAt: 1 }),
      item('child-a', { parentId: 'root', status: 'done', lastActiveAt: 3 }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].session.id).toBe('root');
    // running outranks done, so child-b stays first even with the older stamp.
    expect(tree[0].children.map((node) => node.session.id)).toEqual(['child-b', 'child-a']);
  });

  it('keeps a subagent whose parent is not tracked at the top level', () => {
    const tree = buildSessionTree([item('orphan', { parentId: 'missing', status: 'running' })]);

    expect(tree).toHaveLength(1);
    expect(tree[0].session.id).toBe('orphan');
    expect(tree[0].children).toHaveLength(0);
  });

  it('breaks a parent/child cycle instead of recursing', () => {
    const tree = buildSessionTree([
      item('a', { parentId: 'b' }),
      item('b', { parentId: 'a' }),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree.map((node) => node.session.id).sort()).toEqual(['a', 'b']);
    expect(tree.flatMap((node) => node.children)).toEqual([]);
  });

  it('treats a session that is its own parent as a root', () => {
    const tree = buildSessionTree([item('self', { parentId: 'self' })]);

    expect(tree).toHaveLength(1);
    expect(tree[0].session.id).toBe('self');
    expect(tree[0].children).toHaveLength(0);
  });

  it('ranks a parent by the best status in its subtree and ties by activity', () => {
    const tree = buildSessionTree([
      item('quiet', { status: 'done', lastActiveAt: 5 }),
      item('busy', { status: 'done', lastActiveAt: 1 }),
      item('busy-child', { parentId: 'busy', status: 'question', lastActiveAt: 1 }),
      item('older-question', { status: 'question', lastActiveAt: 2 }),
    ]);

    // `busy` inherits the question rank from its child; the two question-ranked
    // roots tie on rank and fall back to the newest activity.
    expect(tree.map((node) => node.session.id)).toEqual(['older-question', 'busy', 'quiet']);
  });

  it('falls back to positional ids when sessions have no id', () => {
    const tree = buildSessionTree([
      { title: 'first', status: 'running' },
      { title: 'second', status: 'done' },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });
});
