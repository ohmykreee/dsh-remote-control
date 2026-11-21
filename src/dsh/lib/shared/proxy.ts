/**
 * Reverse-proxy client addresses.
 *
 * The LAN listener only trusts `X-Forwarded-For`-style headers when the TCP
 * peer is in the configured proxy list. The headers are read in a fixed
 * priority order: single-address headers set by one edge first, then chained
 * headers where the rightmost untrusted hop is the client. Values are always
 * parsed and range-checked; malformed entries fall through to the next header.
 */

import net from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/** Headers copied out of the handshake once the socket peer is trusted. */
export const FORWARDED_CLIENT_HEADERS = [
  'cf-connecting-ip',
  'true-client-ip',
  'x-real-ip',
  'fastly-client-ip',
  'x-client-ip',
  'x-forwarded-for',
  'forwarded',
  'x-original-forwarded-for',
  'x-cluster-client-ip',
  'x-forwarded',
] as const;

export type ForwardedClientHeaderName = (typeof FORWARDED_CLIENT_HEADERS)[number];

/** The subset of request headers that can carry the original client address. */
export type ForwardedClientHeaders = {
  [K in ForwardedClientHeaderName]?: string | string[];
};

/** Addresses set directly by one edge, in trust order. */
const SINGLE_VALUE_HEADERS: readonly ForwardedClientHeaderName[] = [
  'cf-connecting-ip',
  'true-client-ip',
  'x-real-ip',
  'fastly-client-ip',
  'x-client-ip',
];

/** Comma-separated chains; a `Forwarded` element uses the RFC 7239 `for=` key. */
const CHAIN_HEADERS: readonly ForwardedClientHeaderName[] = [
  'x-forwarded-for',
  'forwarded',
  'x-original-forwarded-for',
  'x-cluster-client-ip',
  'x-forwarded',
];

const MAX_TRUSTED_PROXIES = 64;
const MAX_TRUSTED_PROXY_LENGTH = 64;

/** Copy only the real-IP headers so a connected client can be re-resolved. */
export function pickForwardedClientHeaders(headers: IncomingHttpHeaders): ForwardedClientHeaders {
  const picked: ForwardedClientHeaders = {};
  for (const name of FORWARDED_CLIENT_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') picked[name] = value;
    else if (Array.isArray(value)) picked[name] = [...value];
  }
  return picked;
}

/** Keep `1.2.3.4:80`-style port suffixes but not arbitrary text. */
function normalizeAddressToken(raw: string, allowPort: boolean): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value || value.startsWith('_') || /^unknown$/iu.test(value)) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return null;
    const inner = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/u.test(rest)) return null;
    value = inner;
  } else if (allowPort && net.isIP(value) === 0) {
    const colon = value.lastIndexOf(':');
    if (colon > 0) {
      const port = value.slice(colon + 1);
      const host = value.slice(0, colon);
      if (/^\d{1,5}$/u.test(port) && net.isIP(host) === 4) value = host;
    }
  }
  // A zone id is meaningful only on a link-local IPv6 socket address.
  const zone = value.indexOf('%');
  if (zone > 0) {
    const base = value.slice(0, zone);
    if (net.isIP(base) !== 6) return null;
    value = base;
  }
  const family = net.isIP(value);
  if (family === 0) return null;
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value);
    if (mapped) return net.isIP(mapped[1]) === 4 ? mapped[1] : null;
    return value.toLowerCase();
  }
  return value;
}

function prefixMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

/** Normalize one configured address or CIDR; `null` means unusable. */
function normalizeProxyEntry(raw: string): string | null {
  let text = raw.trim();
  if (!text || text.length > MAX_TRUSTED_PROXY_LENGTH) return null;
  // A zone id is valid on a socket address but ambiguous in configuration.
  if (text.includes('%')) return null;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  let prefix: number | null = null;
  const slash = text.indexOf('/');
  if (slash >= 0) {
    const prefixText = text.slice(slash + 1);
    if (!/^\d{1,3}$/u.test(prefixText)) return null;
    prefix = Number(prefixText);
    text = text.slice(0, slash);
  }
  const address = normalizeAddressToken(text, false);
  if (!address) return null;
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return null;
    if (prefix === null) return address;
    if (prefix > 32) return null;
    return `${intToIpv4(value & prefixMask(prefix))}/${prefix}`;
  }
  if (family === 6) {
    if (prefix !== null && prefix > 128) return null;
    return prefix === null ? address : `${address}/${prefix}`;
  }
  return null;
}

/**
 * Normalize the trusted-proxy setting. Accepts an array or one comma-separated
 * string; invalid entries are dropped, IPv4 CIDRs are reduced to their network
 * address, and duplicates keep their first position.
 */
export function normalizeTrustedProxies(value: unknown): string[] {
  return parseTrustedProxies(value).proxies;
}

/** Result of parsing a trusted-proxy list, including unusable entries. */
export interface TrustedProxyParse {
  proxies: string[];
  invalid: string[];
}

/**
 * Parse a trusted-proxy list.
 *
 * Only ASCII commas separate entries; any other separator (a full-width comma,
 * semicolon, space inside an entry, ...) leaves an unusable token in `invalid`.
 * The settings request rejects such input instead of silently saving a shorter
 * list, while config loading keeps the usable entries.
 */
export function parseTrustedProxies(value: unknown): TrustedProxyParse {
  const rawEntries: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') rawEntries.push(item);
  } else if (typeof value === 'string') {
    rawEntries.push(value);
  }
  const proxies: string[] = [];
  const invalid: string[] = [];
  for (const raw of rawEntries) {
    const wholeInputBlank = raw.trim() === '';
    for (const piece of raw.split(',')) {
      const token = piece.trim();
      if (!token) {
        // A blank list is valid; a blank slot between commas is not.
        if (!wholeInputBlank) invalid.push(piece);
        continue;
      }
      const normalized = normalizeProxyEntry(token);
      if (!normalized) {
        invalid.push(token);
        continue;
      }
      if (!proxies.includes(normalized) && proxies.length < MAX_TRUSTED_PROXIES) proxies.push(normalized);
    }
  }
  return { proxies, invalid };
}

function splitEntry(entry: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const normalized = normalizeProxyEntry(entry);
  if (!normalized) return null;
  const slash = normalized.indexOf('/');
  const address = slash < 0 ? normalized : normalized.slice(0, slash);
  const family = net.isIP(address);
  if (family !== 4 && family !== 6) return null;
  const prefix = slash < 0 ? (family === 4 ? 32 : 128) : Number(normalized.slice(slash + 1));
  return { address, prefix, family: family === 4 ? 'ipv4' : 'ipv6' };
}

function blockList(trusted: readonly string[]): net.BlockList {
  const list = new net.BlockList();
  for (const entry of trusted) {
    const parsed = splitEntry(entry);
    if (!parsed) continue;
    try {
      list.addSubnet(parsed.address, parsed.prefix, parsed.family);
    } catch {
      // A stale/invalid persisted entry must never break the running server.
    }
  }
  return list;
}

/** True when `ip` is one of the configured proxy addresses or inside a range. */
export function isTrustedProxyAddress(ip: string, trusted: readonly string[]): boolean {
  if (trusted.length === 0) return false;
  const address = normalizeAddressToken(ip, false);
  if (!address) return false;
  const family = net.isIP(address);
  if (family !== 4 && family !== 6) return false;
  try {
    return blockList(trusted).check(address, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}

function headerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

function parseForwardedValue(value: string): string[] {
  const output: string[] = [];
  for (const element of value.split(',')) {
    for (const pair of element.split(';')) {
      const equals = pair.indexOf('=');
      if (equals < 0) continue;
      if (pair.slice(0, equals).trim().toLowerCase() !== 'for') continue;
      const address = normalizeAddressToken(pair.slice(equals + 1), true);
      if (address) output.push(address);
      break;
    }
  }
  return output;
}

function chainAddresses(name: ForwardedClientHeaderName, value: string | string[] | undefined): string[] {
  const output: string[] = [];
  for (const entry of headerValues(value)) {
    if (name === 'forwarded') {
      output.push(...parseForwardedValue(entry));
      continue;
    }
    for (const token of entry.split(',')) {
      const address = normalizeAddressToken(token, true);
      if (address) output.push(address);
    }
  }
  return output;
}

/**
 * Pick the rightmost hop that is not itself a trusted proxy. A properly
 * configured proxy appends the address it saw at the end, so this skips the
 * proxies in front of the app and ignores any spoofed entries further left.
 */
function rightmostClient(addresses: readonly string[], trusted: readonly string[]): string | null {
  if (addresses.length === 0) return null;
  for (let index = addresses.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxyAddress(addresses[index], trusted)) return addresses[index];
  }
  return addresses[0];
}

/**
 * Resolve the address shown for one connection.
 *
 * Headers are ignored unless the socket peer is a trusted proxy. Priority:
 * `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP`, `Fastly-Client-IP`,
 * `X-Client-IP`, then the chained `X-Forwarded-For`, `Forwarded`,
 * `X-Original-Forwarded-For`, `X-Cluster-Client-IP`, and `X-Forwarded`.
 * Falls back to the socket peer when no header yields a valid address.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  headers: ForwardedClientHeaders,
  trusted: readonly string[],
): string {
  const remote = normalizeAddressToken(String(remoteAddress || ''), false) ?? '';
  if (!remote || !isTrustedProxyAddress(remote, trusted)) return remote;
  for (const name of SINGLE_VALUE_HEADERS) {
    const value = headerValues(headers[name])[0];
    const address = value ? normalizeAddressToken(value.split(',')[0] ?? '', true) : null;
    if (address) return address;
  }
  for (const name of CHAIN_HEADERS) {
    const address = rightmostClient(chainAddresses(name, headers[name]), trusted);
    if (address) return address;
  }
  return remote;
}
