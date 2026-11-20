import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_PAGE_URL,
  DEFAULT_ORDER,
  enabledOrder,
  normalizeOrder,
  resolveCustomPageUrl,
} from '../../src/svelte/lib/pages.ts';
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
      'custom',
    ]);
    expect(normalizeOrder(['home', 'bogus', 'home', 'music'])).toEqual([
      'home',
      'music',
      'sessions',
      'quickqa',
      'performance',
      'custom',
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
      custom: false,
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
      custom: false,
    };

    expect(enabledOrder(order, enabled)).toEqual(['home']);
  });

  it('treats a missing flag as enabled', () => {
    const order: PageKey[] = ['home', 'sessions'];
    const enabled = { home: true } as Record<PageKey, boolean>;

    expect(enabledOrder(order, enabled)).toEqual(['home', 'sessions']);
  });

  it('hides the custom page when the Host has not enabled it', () => {
    const order: PageKey[] = ['home', 'custom'];
    const enabled = { home: true } as Record<PageKey, boolean>;

    expect(enabledOrder(order, { ...enabled, custom: false })).toEqual(['home']);
  });
});

describe('resolveCustomPageUrl', () => {
  it('falls back to the built-in page when nothing was pushed', () => {
    expect(DEFAULT_CUSTOM_PAGE_URL).toBe('https://www.kre3.net/');
    expect(resolveCustomPageUrl(undefined)).toBe(DEFAULT_CUSTOM_PAGE_URL);
    expect(resolveCustomPageUrl('')).toBe(DEFAULT_CUSTOM_PAGE_URL);
    expect(resolveCustomPageUrl('   ')).toBe(DEFAULT_CUSTOM_PAGE_URL);
  });

  it('adds https to a bare host and keeps http(s) addresses', () => {
    expect(resolveCustomPageUrl('www.example.com')).toBe('https://www.example.com/');
    expect(resolveCustomPageUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(resolveCustomPageUrl('https://example.com')).toBe('https://example.com/');
  });

  it('rejects non-http schemes and unusable input', () => {
    expect(resolveCustomPageUrl('javascript:alert(1)')).toBe(DEFAULT_CUSTOM_PAGE_URL);
    expect(resolveCustomPageUrl('ftp://example.com')).toBe(DEFAULT_CUSTOM_PAGE_URL);
    expect(resolveCustomPageUrl('not a url')).toBe(DEFAULT_CUSTOM_PAGE_URL);
  });
});
