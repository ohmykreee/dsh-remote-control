/**
 * Shared media enrichment for the Rust probe result.
 *
 * It normalises the raw payload, projects the timeline between polls, and
 * decides whether seeking is trustworthy. NetEase cover/liked data is resolved
 * in Rust (`vendor::netease`) and arrives already attached to the payload.
 */

import { clamp, finiteNumber } from './util.js';

export function publicMedia(result) {
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
    trackId: media.trackId || null,
    estimatedDuration: Boolean(media.estimatedDuration),
    sampledAt: finiteNumber(result.sampledAt, Date.now()) || Date.now(),
  };
}

export function mediaKey(media) {
  return `${media?.appId || ''}|${media?.title || ''}|${media?.artist || ''}`;
}

function timelineAnchor(value, sampledAt) {
  const anchor = finiteNumber(value, null);
  if (!anchor || anchor <= 0) return null;
  const age = sampledAt - anchor;
  return age >= -5000 && age <= 6 * 60 * 60 * 1000 ? anchor : null;
}

/**
 * Creates a stateful enricher. One instance per media adapter (the smoothing and
 * "has this player ever reported a position" evidence are per adapter).
 */
export function createMediaEnrichment() {
  let progress = null;
  let pendingSeek = null;
  let positionEvidence = null;

  async function enrich(result) {
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
    const canSeek = Boolean(media.canSeek) && smtcTimeline && hasPositionReport;
    const timelineSource = smtcTimeline ? 'smtc' : 'none';

    media.canSeek = canSeek;
    media.positionReported = hasPositionReport;
    media.timelineSource = timelineSource;
    media.estimatedDuration = false;

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

  /** Hold a requested seek position while the player catches up. */
  function markSeek(key, position, until = Date.now() + 2600) {
    pendingSeek = { key, position, until };
  }

  function reset() {
    progress = null;
    pendingSeek = null;
    positionEvidence = null;
  }

  return { enrich, markSeek, reset };
}
