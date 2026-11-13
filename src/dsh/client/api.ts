/**
 * Loopback API helpers for the DSH sidebar page.
 *
 * Every request is same-origin and uncached; errors carry the JSON `error`
 * field when the Host supplies one.
 */

import type { RemoteClient, SettingsPayload } from './types.js';

export const SETTINGS_URL = '/dsh-remote-control/api/settings';
export const APP_NAMES_URL = '/dsh-remote-control/api/apps';
export const LOCATION_URL = '/dsh-remote-control/api/location';
export const GEOCODE_URL = '/dsh-remote-control/api/geocode';
export const THEME_URL = '/dsh-remote-control/api/theme';
export const TOKEN_URL = '/dsh-remote-control/api/token/rotate';
export const DISCONNECT_URL = '/dsh-remote-control/api/disconnect';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSettingsPayload(value: unknown): value is SettingsPayload {
  return isRecord(value) && isRecord(value.settings);
}

export function errorText(value: unknown): string | undefined {
  const error = isRecord(value) ? value.error : undefined;
  return error ? String(error) : undefined;
}

export function describeError(error: unknown): string {
  const message = isRecord(error) ? error.message : undefined;
  return message ? String(message) : String(error);
}

function isRemoteClient(value: unknown): value is RemoteClient {
  return isRecord(value) && typeof value.id === 'string' && typeof value.ip === 'string' && typeof value.connectedAt === 'number';
}

export function readClients(value: unknown): RemoteClient[] {
  const list: unknown[] = isRecord(value) && Array.isArray(value.clients) ? value.clients : [];
  return list.filter(isRemoteClient);
}

/** Fetch JSON from a loopback route and turn non-2xx responses into errors. */
export async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
  return payload;
}

/** POST a JSON body to a loopback route. */
export function postJson(url: string, body?: unknown): Promise<unknown> {
  return requestJson(url, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
