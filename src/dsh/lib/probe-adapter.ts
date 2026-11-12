/**
 * Rust-backed media/volume adapter.
 *
 * `dsh-probe` is the only OS probe layer: there is no PowerShell, playerctl,
 * wpctl or osascript fallback. When the binary is missing every read returns a
 * clear error state and every control action throws that error.
 *
 * Media progress smoothing / seek eligibility lives in `media-enrich.js`.
 */

import type { JsonRecord, ProbeMediaResult, PublicMedia } from './types.js';
import { probeInfo, materializeThumbnail, runProbe } from './probe.js';
import { createMediaEnrichment, mediaKey } from './media-enrich.js';
import { clamp, finiteNumber, serializeError } from './util.js';

const MEDIA_TTL_MS = 1400;
const VOLUME_TTL_MS = 3000;
const ERROR_TTL_MS = 5000;
const MEDIA_ACTIONS = ['playpause', 'next', 'previous', 'seek', 'like', 'volume', 'mute'];

/** Cached `media read` / media action result, plus the cache-hit marker. */
export interface MediaCache {
  ok: boolean;
  available: boolean;
  media: PublicMedia | null;
  error: string | null;
  backend: 'rust';
  updatedAt: number;
  cached?: boolean;
}

/** Cached `volume read` / volume action result, plus the cache-hit marker. */
export interface VolumeCache {
  ok: boolean;
  available: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
  backend: 'rust';
  updatedAt: number;
  cached?: boolean;
}

/** One channel projected for diagnostics; every field is null before the first read. */
interface ChannelStatus {
  ok: boolean | null;
  available: boolean | null;
  error: string | null;
  backend: 'rust' | null;
  updatedAt: number | null;
}

export interface MediaAdapterStatus {
  media: ChannelStatus;
  volume: ChannelStatus;
}

/** Media plus volume snapshot handed to the browser. */
export interface MediaStatePayload {
  ok: boolean;
  media: MediaCache;
  volume: VolumeCache;
  label: string;
  sampledAt: number;
}

/** Result of `control('volume' | 'mute', ...)`. */
interface VolumeControlResult {
  ok: true;
  action: string;
  volume: VolumeCache;
}

/** Result of the remaining media actions. */
interface MediaControlResult {
  ok: true;
  action: string;
  media: MediaCache;
}

/** Error raised by a probe action, carrying the raw payload for diagnostics. */
interface ProbeActionError extends Error {
  probeResult?: JsonRecord;
}

/** The adapter surface consumed by the platform wiring and the DSH service. */
interface ProbeMediaAdapter {
  getState(): Promise<MediaStatePayload>;
  getMedia(force?: boolean): Promise<MediaCache>;
  getVolume(force?: boolean): Promise<VolumeCache>;
  control(action: string, value?: number | boolean | null): Promise<VolumeControlResult | MediaControlResult>;
  status(): MediaAdapterStatus;
}

function probeUnavailable(): Error {
  const info = probeInfo();
  return new Error(info.error || 'native probe unavailable');
}

export function createProbeMediaAdapter({ label = '平台' }: { label?: string } = {}): ProbeMediaAdapter {
  let mediaCache: MediaCache | null = null;
  let mediaAt = 0;
  let volumeCache: VolumeCache | null = null;
  let volumeAt = 0;
  const enrichment = createMediaEnrichment();

  function activeAppId(): string {
    return mediaCache?.media?.appId || '';
  }

  async function callProbe(...args: string[]): Promise<ProbeMediaResult> {
    const info = probeInfo();
    if (!info.available) throw probeUnavailable();
    const result: ProbeMediaResult = await materializeThumbnail(await runProbe(args));
    if (result?.ok === false) {
      const error: ProbeActionError = new Error(
        String(result.actionError || result.error || `dsh-probe ${args.join(' ')} failed`),
      );
      error.probeResult = result;
      throw error;
    }
    return result;
  }

  async function getMedia(force: boolean = false): Promise<MediaCache> {
    const now = Date.now();
    const ttl = mediaCache?.ok ? MEDIA_TTL_MS : ERROR_TTL_MS;
    if (!force && mediaCache && now - mediaAt < ttl) return { ...mediaCache, cached: true };

    try {
      const args = ['media', 'read'];
      const appId = activeAppId();
      if (appId) args.push('--app-id', appId);
      const result = await callProbe(...args);
      mediaCache = {
        ok: true,
        available: result.available !== false,
        media: await enrichment.enrich(result),
        error: null,
        backend: 'rust',
        updatedAt: now,
      };
    } catch (error) {
      mediaCache = {
        ok: false,
        available: false,
        media: null,
        error: serializeError(error),
        backend: 'rust',
        updatedAt: now,
      };
    }
    mediaAt = Date.now();
    return mediaCache;
  }

  async function getVolume(force: boolean = false): Promise<VolumeCache> {
    const now = Date.now();
    const ttl = volumeCache?.ok ? VOLUME_TTL_MS : ERROR_TTL_MS;
    if (!force && volumeCache && now - volumeAt < ttl) return { ...volumeCache, cached: true };

    try {
      const result = await callProbe('volume', 'read');
      volumeCache = {
        ok: true,
        available: true,
        volume: clamp(finiteNumber(result.volume, 0.5) ?? 0.5, 0, 1),
        muted: Boolean(result.muted),
        error: null,
        backend: 'rust',
        updatedAt: now,
      };
    } catch (error) {
      volumeCache = {
        ok: false,
        available: false,
        volume: 0.5,
        muted: false,
        error: serializeError(error),
        backend: 'rust',
        updatedAt: now,
      };
    }
    volumeAt = Date.now();
    return volumeCache;
  }

  async function controlVolume(normalized: string, value: number | null): Promise<VolumeControlResult> {
    const level = clamp(finiteNumber(value, 0.5) ?? 0.5, 0, 1);
    const result = normalized === 'mute'
      ? await callProbe('volume', 'toggle')
      : await callProbe('volume', 'set', '--value', String(level));
    volumeCache = {
      ok: true,
      available: true,
      volume: clamp(finiteNumber(result.volume, level) ?? level, 0, 1),
      muted: Boolean(result.muted),
      error: null,
      backend: 'rust',
      updatedAt: Date.now(),
    };
    volumeAt = Date.now();
    return { ok: true, action: normalized, volume: volumeCache };
  }

  async function control(
    action: string,
    value: number | boolean | null = null,
  ): Promise<VolumeControlResult | MediaControlResult> {
    const normalized = String(action || '').toLowerCase();
    if (!MEDIA_ACTIONS.includes(normalized)) throw new Error('Unsupported media action');
    if (normalized === 'volume' || normalized === 'mute') {
      return controlVolume(normalized, Number(value));
    }
    if (normalized === 'like' && !mediaCache?.media?.canSetLiked) {
      throw new Error('当前播放器不支持修改红心');
    }

    let position = 0;
    if (normalized === 'seek') {
      if (!mediaCache?.media?.canSeek) throw new Error('当前播放器只上报进度，不支持拖动');
      position = clamp(finiteNumber(value, 0) ?? 0, 0, 24 * 60 * 60);
    }

    if (normalized === 'seek') enrichment.markSeek(mediaKey(mediaCache?.media), position);
    const args = ['media', normalized];
    if (normalized === 'seek') args.push('--position', String(position));
    if (normalized === 'like' && typeof value === 'boolean') {
      args.push('--value', value ? 'true' : 'false');
    }
    const appId = activeAppId();
    if (appId) args.push('--app-id', appId);
    const result = await callProbe(...args);
    mediaCache = {
      ok: true,
      available: result.available !== false,
      media: await enrichment.enrich(result),
      error: null,
      backend: 'rust',
      updatedAt: Date.now(),
    };
    mediaAt = Date.now();
    return { ok: true, action: normalized, media: mediaCache };
  }

  async function getState(): Promise<MediaStatePayload> {
    const [media, volume] = await Promise.all([getMedia(), getVolume()]);
    return { ok: media.ok || volume.ok, media, volume, label, sampledAt: Date.now() };
  }

  function status(): MediaAdapterStatus {
    return {
      media: mediaCache
        ? {
            ok: mediaCache.ok,
            available: mediaCache.available,
            error: mediaCache.error,
            backend: mediaCache.backend,
            updatedAt: mediaCache.updatedAt,
          }
        : { ok: null, available: null, error: null, backend: null, updatedAt: null },
      volume: volumeCache
        ? {
            ok: volumeCache.ok,
            available: volumeCache.available,
            error: volumeCache.error,
            backend: volumeCache.backend,
            updatedAt: volumeCache.updatedAt,
          }
        : { ok: null, available: null, error: null, backend: null, updatedAt: null },
    };
  }

  return { getState, getMedia, getVolume, control, status };
}
