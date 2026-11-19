/**
 * Short-lived image handoff between the LAN upload route and one Quick Q&A
 * prompt.
 *
 * The phone has no DSH Session yet when the user attaches an image, so it
 * uploads the bytes first and sends the returned id with the next question.
 * The Host keeps that image in memory until a prompt consumes it, then hands
 * the encoded bytes to the official Session controller, which promotes them to
 * a durable attachment reference.
 */

import crypto from 'node:crypto';

/** Accepted source formats; mirrors the official image attachment vocabulary. */
export const QUICKQA_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type QuickQaImageMediaType = (typeof QUICKQA_IMAGE_MEDIA_TYPES)[number];

/** One image is attached per question; keep a bounded LAN upload. */
export const QUICKQA_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
/** An unclaimed upload is dropped instead of pinning its bytes forever. */
export const QUICKQA_IMAGE_TTL_MS = 10 * 60_000;

export interface QuickQaImage {
  id: string;
  mediaType: QuickQaImageMediaType;
  /** Canonical base64 of the encoded source bytes. */
  data: string;
  bytes: number;
}

export interface QuickQaImageStore {
  save(mediaType: QuickQaImageMediaType, data: Uint8Array): QuickQaImage;
  /** Remove and return one image so a prompt can use it exactly once. */
  take(id: string): QuickQaImage | null;
  clear(): void;
}

interface StoredImage extends QuickQaImage {
  at: number;
}

/** Normalize a request Content-Type; null means the format is not supported. */
export function normalizeQuickQaImageType(value: unknown): QuickQaImageMediaType | null {
  const type = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return (QUICKQA_IMAGE_MEDIA_TYPES as readonly string[]).includes(type)
    ? type as QuickQaImageMediaType
    : null;
}

/** Reject bytes whose leading signature does not match the declared format. */
export function imageBytesMatch(mediaType: QuickQaImageMediaType, data: Uint8Array): boolean {
  if (data.length < 12) return false;
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...data.subarray(start, start + length));
  if (mediaType === 'image/png') return data[0] === 0x89 && ascii(1, 3) === 'PNG';
  if (mediaType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mediaType === 'image/gif') return ascii(0, 4) === 'GIF8';
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
}

export function createQuickQaImageStore(options: {
  maxBytes?: number;
  ttlMs?: number;
} = {}): QuickQaImageStore {
  const maxBytes = Math.max(1, options.maxBytes ?? QUICKQA_IMAGE_LIMIT_BYTES);
  const ttlMs = Math.max(1_000, options.ttlMs ?? QUICKQA_IMAGE_TTL_MS);
  const images = new Map<string, StoredImage>();

  function purge(now: number): void {
    for (const [id, entry] of images) {
      if (now - entry.at > ttlMs) images.delete(id);
    }
  }

  return {
    save(mediaType, data) {
      const now = Date.now();
      purge(now);
      if (data.length === 0) throw new Error('image is empty');
      if (data.length > maxBytes) throw new Error('image is too large');
      if (!imageBytesMatch(mediaType, data)) throw new Error('image bytes do not match their type');
      const id = crypto.randomUUID();
      const image: StoredImage = {
        id,
        mediaType,
        data: Buffer.from(data).toString('base64'),
        bytes: data.length,
        at: now,
      };
      images.set(id, image);
      return { id, mediaType, data: image.data, bytes: image.bytes };
    },
    take(id) {
      const entry = images.get(id);
      if (!entry) return null;
      images.delete(id);
      if (Date.now() - entry.at > ttlMs) return null;
      return { id: entry.id, mediaType: entry.mediaType, data: entry.data, bytes: entry.bytes };
    },
    clear() {
      images.clear();
    },
  };
}
