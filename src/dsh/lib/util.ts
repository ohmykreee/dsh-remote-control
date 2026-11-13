/** Shared, dependency-free helpers for the Host half. */

import type { JsonRecord } from './types.js';
import { isRecord } from './types.js';

export const VERSION = '1.0.0';
export const PANEL_ID = 'remote-control';
export const ROUTE_PREFIX = '/dsh-remote-control';
export const INFO_PATH = `${ROUTE_PREFIX}/api/info`;
export const QR_PATH = `${ROUTE_PREFIX}/qr.svg`;
export const SETTINGS_PATH = `${ROUTE_PREFIX}/api/settings`;
export const APP_NAMES_PATH = `${ROUTE_PREFIX}/api/apps`;
export const LOCATION_PATH = `${ROUTE_PREFIX}/api/location`;
export const GEOCODE_PATH = `${ROUTE_PREFIX}/api/geocode`;
export const THEME_PATH = `${ROUTE_PREFIX}/api/theme`;
export const TOKEN_ROTATE_PATH = `${ROUTE_PREFIX}/api/token/rotate`;
export const DISCONNECT_PATH = `${ROUTE_PREFIX}/api/disconnect`;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function finiteNumber(value: unknown, fallback?: null): number | null;
export function finiteNumber(value: unknown, fallback: number): number;
export function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeString(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

export function decodeXml(value: unknown): string {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function basename(filePath: unknown): string {
  if (typeof filePath !== 'string' || filePath.length === 0) return '';
  const normalized = filePath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

export function isObject(value: unknown): value is JsonRecord {
  return isRecord(value);
}

export function sniffImageMediaType(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 16)).toString('ascii');
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 12).includes('ftyp')) return 'image/avif';
  return null;
}

export function startOfLocalDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monday 00:00 in the host's local timezone. */
export function startOfLocalWeek(date: Date = new Date()): Date {
  const d = startOfLocalDay(date);
  const day = d.getDay(); // Sunday = 0
  const delta = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - delta);
  return d;
}

export function localTimezoneOffsetSeconds(date: Date = new Date()): number {
  return -date.getTimezoneOffset() * 60;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}
