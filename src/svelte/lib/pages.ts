import type { PageKey } from './types';

export const DEFAULT_ORDER: readonly PageKey[] = ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom'];

/** Page shown when the Host has not pushed a custom address. */
export const DEFAULT_CUSTOM_PAGE_URL = 'https://www.kre3.net/';

/**
 * Resolve the custom page address. A bare host gets `https://`, only http(s)
 * URLs are accepted, and anything missing or unusable falls back to the
 * built-in page instead of leaving the iframe blank.
 */
export function resolveCustomPageUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return DEFAULT_CUSTOM_PAGE_URL;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) return DEFAULT_CUSTOM_PAGE_URL;
  const candidate = scheme ? raw : `https://${raw.replace(/^\/\//, '')}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_CUSTOM_PAGE_URL;
    return url.toString();
  } catch {
    return DEFAULT_CUSTOM_PAGE_URL;
  }
}

export function normalizeOrder(input: unknown): PageKey[] {
  const keys = Array.isArray(input)
    ? input.filter((key): key is PageKey => DEFAULT_ORDER.includes(key as PageKey))
    : [];
  const order = [...new Set(keys)];
  for (const key of DEFAULT_ORDER) if (!order.includes(key)) order.push(key);
  return order.slice(0, DEFAULT_ORDER.length);
}

export function enabledOrder(order: PageKey[], pageEnabled: Record<PageKey, boolean>): PageKey[] {
  const enabled = order.filter((key) => pageEnabled[key] !== false);
  if (enabled.length > 0) return enabled;
  return ['home'];
}
