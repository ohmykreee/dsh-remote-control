/** SMTC playback and system volume through the JavaScript Windows bridge. */

import { getNeteaseTrack, setNeteaseLiked } from './netease.js';
import { runSmtc, runVolume } from './win/bridge.js';
import { clamp, finiteNumber, serializeError } from './util.js';

const MEDIA_TTL_MS = 1400;
const VOLUME_TTL_MS = 3000;
const ERROR_TTL_MS = 5000;

function publicMedia(result) {
  if (!result?.media) return null;
  const media = result.media;
  return {
    appId: media.appId || '',
    title: media.title || '未命名媒体',
    artist: media.artist || '',
    album: media.album || '',
    albumArtist: media.albumArtist || '',
    playbackStatus: media.playbackStatus || 'Closed',
    autoRepeatMode: media.autoRepeatMode || '',
    shuffleActive: Boolean(media.shuffleActive),
    position: Math.max(0, finiteNumber(media.position, 0) || 0),
    startTime: Math.max(0, finiteNumber(media.startTime, 0) || 0),
    endTime: Math.max(0, finiteNumber(media.endTime, 0) || 0),
    minSeekTime: Math.max(0, finiteNumber(media.minSeekTime, 0) || 0),
    maxSeekTime: Math.max(0, finiteNumber(media.maxSeekTime, 0) || 0),
    lastUpdatedAt: finiteNumber(media.lastUpdatedAt, null),
    canPlayPause: media.canPlayPause !== false,
    canNext: media.canNext !== false,
    canPrevious: media.canPrevious !== false,
    canSeek: Boolean(media.canSeek),
    thumbnail: media.thumbnail || null,
    thumbnailType: media.thumbnailType || null,
    liked: typeof media.liked === 'boolean' ? media.liked : null,
    canLike: Boolean(media.canLike),
    likeWritable: Boolean(media.likeWritable),
    trackId: media.trackId || null,
    estimatedDuration: Boolean(media.estimatedDuration),
    sampledAt: finiteNumber(result.sampledAt, Date.now()) || Date.now(),
  };
}

function mediaKey(media) {
  return `${media?.appId || ''}|${media?.title || ''}|${media?.artist || ''}`;
}

function timelineAnchor(value, sampledAt) {
  const anchor = finiteNumber(value, null);
  if (!anchor || anchor <= 0) return null;
  const age = sampledAt - anchor;
  return age >= -5000 && age <= 6 * 60 * 60 * 1000 ? anchor : null;
}

export function createMediaService() {
  let mediaCache = null;
  let mediaAt = 0;
  let mediaErrorAt = 0;
  let volumeCache = null;
  let volumeAt = 0;
  let volumeErrorAt = 0;
  let progress = null;
  let pendingSeek = null;
  let positionEvidence = null;

  function isNetease(appId) {
    return /cloudmusic/i.test(String(appId || ''));
  }

  async function enrichMedia(result) {
    const sampledAt = finiteNumber(result?.sampledAt, Date.now()) || Date.now();
    let media = publicMedia(result);
    if (!media) {
      progress = null;
      pendingSeek = null;
      positionEvidence = null;
      return null;
    }

    const rawStart = Math.max(0, Number(media.startTime) || 0);
    const rawEnd = Math.max(0, Number(media.endTime) || 0);
    const rawPosition = Math.max(0, Number(media.position) || 0);
    const smtcTimeline = rawEnd > rawStart && rawEnd > 0;
    const playing = String(media.playbackStatus).toLowerCase() === 'playing';
    const key = mediaKey(media);

    // IsPlaybackPositionEnabled can be true even when a player never reports a
    // usable position (NetEase does this). Only allow seeking after we have
    // actually seen a non-zero position for this track.
    if (!positionEvidence || positionEvidence.key !== key) {
      positionEvidence = { key, seen: rawPosition > 0.01, playing };
    } else {
      // Replaying the same track from 0 starts a new position session even if
      // the title/artist key is unchanged; do not inherit the old seek grant.
      if (playing && !positionEvidence.playing && rawPosition <= 0.01) positionEvidence.seen = false;
      if (rawPosition > 0.01) positionEvidence.seen = true;
      positionEvidence.playing = playing;
    }
    const hasPositionReport = positionEvidence.seen;
    let canSeek = Boolean(media.canSeek) && smtcTimeline && hasPositionReport;
    let timelineSource = smtcTimeline ? 'smtc' : 'none';
    let estimatedDuration = false;

    if (isNetease(media.appId)) {
      let netease = null;
      try {
        netease = await getNeteaseTrack(media.title, media.artist);
      } catch {
        netease = null;
      }
      media.canLike = true;
      media.likeWritable = Boolean(netease?.likeWritable);
      media.liked = netease?.liked ?? null;
      media.trackId = netease?.trackId || null;
      if (!media.thumbnail && netease?.cover) {
        media.thumbnail = netease.cover;
        media.thumbnailType = 'image/jpeg';
      }
      if (!smtcTimeline) {
        // The NetEase desktop client exposes only a private progress report,
        // not a seekable SMTC timeline. Show progress, but never allow seeking.
        timelineSource = 'netease';
        canSeek = false;
        if (netease?.duration) {
          media.endTime = netease.duration;
          media.maxSeekTime = netease.duration;
        } else {
          media.endTime = 240;
          media.maxSeekTime = 240;
          estimatedDuration = true;
        }
      } else if (!canSeek) {
        timelineSource = 'netease';
      }
    }

    media.canSeek = canSeek;
    media.positionReported = hasPositionReport;
    media.timelineSource = timelineSource;
    media.estimatedDuration = estimatedDuration;

    const end = Math.max(0, Number(media.endTime) || 0);
    const start = Math.max(0, Number(media.startTime) || 0);
    const duration = end > start ? end - start : end;
    const clampPosition = (value) => (duration > 0 ? clamp(value, start, start + duration) : Math.max(0, value));

    if (pendingSeek && (pendingSeek.key !== key || sampledAt >= pendingSeek.until)) pendingSeek = null;

    // SMTC timelines report Position at LastUpdatedTime. Project it forward for
    // players that only refresh the timeline a few times per track.
    const anchor = timelineAnchor(media.lastUpdatedAt, sampledAt);
    let reported = rawPosition;
    if (playing && smtcTimeline && anchor) reported += (sampledAt - anchor) / 1000;
    reported = clampPosition(reported);

    if (!progress || progress.key !== key) {
      progress = { key, position: reported, at: sampledAt, playing };
    } else {
      const elapsed = progress.playing ? Math.max(0, (sampledAt - progress.at) / 1000) : 0;
      let position = clampPosition(progress.position + elapsed);
      // Treat 0 as "no position report" while playing: several players expose a
      // duration but keep Position at 0, and snapping back would freeze the bar.
      const reportUsable = rawPosition > 0.01;
      if (reportUsable) {
        const delta = reported - position;
        if (Math.abs(delta) > 2.5) position = reported;
        else if (Math.abs(delta) > 0.35) position = clampPosition(position + delta * 0.45);
      }
      if (playing !== progress.playing && reportUsable) position = reported;
      progress = { key, position, at: sampledAt, playing };
    }

    if (pendingSeek) {
      progress = { key, position: clampPosition(pendingSeek.position), at: sampledAt, playing };
    }

    media.position = progress.position;
    media.sampledAt = sampledAt;
    return media;
  }

  async function getMedia(force = false) {
    const now = Date.now();
    const ttl = mediaCache?.ok ? MEDIA_TTL_MS : ERROR_TTL_MS;
    if (!force && mediaCache && now - mediaAt < ttl) return { ...mediaCache, cached: true };
    try {
      const result = await runSmtc('read');
      mediaCache = {
        ok: result?.ok !== false,
        available: process.platform === 'win32',
        media: await enrichMedia(result),
        error: result?.ok === false ? result?.actionError || 'SMTC unavailable' : null,
        updatedAt: now,
      };
      mediaAt = now;
      mediaErrorAt = 0;
    } catch (error) {
      mediaCache = {
        ok: false,
        available: process.platform === 'win32',
        media: null,
        error: serializeError(error),
        updatedAt: now,
      };
      mediaAt = now;
      mediaErrorAt = now;
    }
    return mediaCache;
  }

  async function getVolume(force = false) {
    const now = Date.now();
    const ttl = volumeCache?.ok ? VOLUME_TTL_MS : ERROR_TTL_MS;
    if (!force && volumeCache && now - volumeAt < ttl) return { ...volumeCache, cached: true };
    try {
      const result = await runVolume('read');
      volumeCache = {
        ok: result?.ok !== false,
        volume: clamp(finiteNumber(result?.volume, 0.5) ?? 0.5, 0, 1),
        muted: Boolean(result?.muted),
        error: result?.ok === false ? result?.error || 'Volume unavailable' : null,
        updatedAt: now,
      };
      volumeAt = now;
      volumeErrorAt = 0;
    } catch (error) {
      volumeCache = {
        ok: false,
        volume: 0.5,
        muted: false,
        error: serializeError(error),
        updatedAt: now,
      };
      volumeAt = now;
      volumeErrorAt = now;
    }
    return volumeCache;
  }

  async function getState() {
    const [media, volume] = await Promise.all([getMedia(), getVolume()]);
    return {
      ok: media.ok || volume.ok,
      media,
      volume,
      sampledAt: Date.now(),
    };
  }

  async function control(action, value = null) {
    const normalized = String(action || '').toLowerCase();
    if (!['playpause', 'next', 'previous', 'seek', 'volume', 'mute', 'like'].includes(normalized)) {
      throw new Error('Unsupported media action');
    }

    if (normalized === 'like') {
      const target = Boolean(value);
      if (!mediaCache?.media?.canLike) throw new Error('当前媒体不支持红心');
      const result = await setNeteaseLiked(target);
      if (!result?.ok) throw new Error(result?.error || '无法设置红心');
      if (mediaCache?.media) mediaCache.media.liked = target;
      return { ok: true, action: normalized, liked: target, media: mediaCache };
    }

    if (normalized === 'volume') {
      const level = clamp(finiteNumber(value, 0.5) ?? 0.5, 0, 1);
      const result = await runVolume('set', level);
      volumeCache = {
        ok: result?.ok !== false,
        volume: clamp(finiteNumber(result?.volume, level) ?? level, 0, 1),
        muted: Boolean(result?.muted),
        error: result?.ok === false ? result?.error || 'Volume unavailable' : null,
        updatedAt: Date.now(),
      };
      volumeAt = Date.now();
      return { ok: volumeCache.ok, action: normalized, volume: volumeCache };
    }

    if (normalized === 'mute') {
      const result = await runVolume('toggle');
      volumeCache = {
        ok: result?.ok !== false,
        volume: clamp(finiteNumber(result?.volume, 0.5) ?? 0.5, 0, 1),
        muted: Boolean(result?.muted),
        error: result?.ok === false ? result?.error || 'Volume unavailable' : null,
        updatedAt: Date.now(),
      };
      volumeAt = Date.now();
      return { ok: volumeCache.ok, action: normalized, volume: volumeCache };
    }

    let position = 0;
    if (normalized === 'seek') {
      if (!mediaCache?.media?.canSeek) throw new Error('当前播放器只上报进度，不支持拖动');
      position = clamp(finiteNumber(value, 0) ?? 0, 0, 24 * 60 * 60);
      pendingSeek = { position, until: Date.now() + 2600, key: mediaKey(mediaCache.media) };
    }
    const result = await runSmtc(normalized, { position, appId: mediaCache?.media?.appId || '' });
    mediaCache = {
      ok: result?.ok !== false,
      available: true,
      media: await enrichMedia(result),
      error: result?.ok === false ? result?.actionError || 'Media action failed' : null,
      updatedAt: Date.now(),
    };
    mediaAt = Date.now();
    return { ok: mediaCache.ok, action: normalized, media: mediaCache };
  }

  function status() {
    return {
      media: mediaCache
        ? { ok: mediaCache.ok, available: mediaCache.available, error: mediaCache.error, updatedAt: mediaCache.updatedAt }
        : { ok: null, available: null, error: null, updatedAt: null },
      volume: volumeCache
        ? { ok: volumeCache.ok, error: volumeCache.error, updatedAt: volumeCache.updatedAt }
        : { ok: null, error: null, updatedAt: null },
    };
  }

  return { getState, getMedia, getVolume, control, status, __test: { enrichMedia } };
}
