/** Low-level HTTP, auth, and network helpers for the LAN console. */

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostMessage } from '../i18n/index.js';
import type { PluginLocale } from '../settings/index.js';
import type { JsonRecord } from '../shared/types.js';
import { isRecord } from '../shared/types.js';
import { serializeError } from '../shared/util.js';
import type { CidrInfo, ResponseHeaders } from './types.js';

export const DEFAULT_PORT = 38765;
export const COOKIE_NAME = 'dsh_rc';
export const BODY_LIMIT = 64 * 1024;
export const POMODORO_SOUND_PATH = '/api/pomodoro/sound';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SAFE_FILE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function safeRelativeFile(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (!segments.every((segment) => segment && segment !== '.' && segment !== '..' && SAFE_FILE_SEGMENT.test(segment))) {
    return null;
  }
  return decoded;
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function ipv4ToInt(ip: string): number | null {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function prefixFromNetmask(netmask: string): number | null {
  const mask = ipv4ToInt(netmask);
  if (mask === null) return null;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if (((mask >>> bit) & 1) === 1) prefix += 1;
    else break;
  }
  return prefix;
}

export function cidrFor(address: string, netmask: string): CidrInfo | null {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (ip === null || mask === null) return null;
  const prefix = prefixFromNetmask(netmask);
  if (prefix === null) return null;
  return { network: ip & mask, mask, prefix, cidr: `${intToIpv4(ip & mask)}/${prefix}` };
}

export function normalizeIp(value: string | undefined): string {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isLoopback(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

export function parsePort(value: string | number): number {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

export function jsonResponse(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: ResponseHeaders = {},
): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function textResponse(
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: ResponseHeaders = {},
): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function unauthorizedPage(locale: PluginLocale): string {
  const title = hostMessage(locale, 'pairingTitle');
  const body = hostMessage(locale, 'pairingBody');
  return `<!doctype html><html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>html,body{height:100%;margin:0;background:#05070d;color:#f4f7ff;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif}main{height:100%;display:grid;place-items:center;padding:32px;box-sizing:border-box}.card{max-width:460px;padding:32px;border:1px solid #1b2436;border-radius:28px;background:#0c111c;box-shadow:0 30px 80px #0008}h1{font-size:24px;margin:0 0 12px}p{color:#93a0b8;margin:0 0 10px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#4d6bff;margin-right:8px}</style>
<main><div class="card"><h1><span class="dot"></span>${title}</h1><p>${body}</p></main></html>`;
}

export function readBody(req: IncomingMessage, limit: number = BODY_LIMIT): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Read a raw binary body with an explicit byte cap. */
export function readBinaryBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** A concrete hostname from the certificate's SAN, falling back to its CN. */
export function certificateDomain(cert: Buffer | string): string | null {
  const clean = (value: string): string | null => {
    const domain = value.trim().replace(/^DNS:/i, '').replace(/\.$/u, '').toLowerCase();
    if (!domain || domain.length > 253 || domain.includes('*') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(domain)) {
      return null;
    }
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu.test(domain)
      ? domain
      : null;
  };
  try {
    const parsed = new crypto.X509Certificate(cert);
    for (const entry of String(parsed.subjectAltName || '').split(',')) {
      const domain = clean(entry);
      if (domain) return domain;
    }
    const commonName = /(?:^|[\n,])\s*CN\s*=\s*([^,\n]+)/iu.exec(parsed.subject);
    return commonName ? clean(commonName[1]) : null;
  } catch {
    return null;
  }
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function describeReadError(errorValue: unknown): string {
  const code = isRecord(errorValue) ? errorValue.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not found';
  return serializeError(errorValue);
}
