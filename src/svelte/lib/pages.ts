import type { PageKey } from './types';

export const DEFAULT_ORDER: readonly PageKey[] = ['home', 'sessions', 'music', 'performance'];

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
