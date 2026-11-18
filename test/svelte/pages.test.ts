import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, enabledOrder, normalizeOrder } from '../../src/svelte/lib/pages.ts';
import type { PageKey } from '../../src/svelte/lib/types.ts';

describe('normalizeOrder', () => {
  it('falls back to the default order for non-lists', () => {
    expect(normalizeOrder(undefined)).toEqual([...DEFAULT_ORDER]);
    expect(normalizeOrder('home')).toEqual([...DEFAULT_ORDER]);
    expect(normalizeOrder({ page: 'home' })).toEqual([...DEFAULT_ORDER]);
  });

  it('keeps known keys, drops unknown and duplicate ones, then fills the gaps', () => {
    expect(normalizeOrder(['music', 'home'])).toEqual([
      'music',
      'home',
      'sessions',
      'quickqa',
      'performance',
    ]);
    expect(normalizeOrder(['home', 'bogus', 'home', 'music'])).toEqual([
      'home',
      'music',
      'sessions',
      'quickqa',
      'performance',
    ]);
  });

  it('never grows past the known page set', () => {
    const order = normalizeOrder(['performance', 'quickqa', 'music', 'sessions', 'home', 'home']);

    expect(order).toHaveLength(DEFAULT_ORDER.length);
    expect([...order].sort()).toEqual([...DEFAULT_ORDER].sort());
  });
});

describe('enabledOrder', () => {
  it('drops disabled pages and keeps the configured order', () => {
    const order: PageKey[] = ['music', 'home', 'sessions'];
    const enabled: Record<PageKey, boolean> = {
      home: true,
      sessions: false,
      quickqa: true,
      music: true,
      performance: false,
    };

    expect(enabledOrder(order, enabled)).toEqual(['music', 'home']);
  });

  it('keeps an empty console usable by falling back to the home page', () => {
    const order: PageKey[] = ['music', 'home'];
    const enabled: Record<PageKey, boolean> = {
      home: false,
      sessions: false,
      quickqa: false,
      music: false,
      performance: false,
    };

    expect(enabledOrder(order, enabled)).toEqual(['home']);
  });

  it('treats a missing flag as enabled', () => {
    const order: PageKey[] = ['home', 'sessions'];
    const enabled = { home: true } as Record<PageKey, boolean>;

    expect(enabledOrder(order, enabled)).toEqual(['home', 'sessions']);
  });
});
