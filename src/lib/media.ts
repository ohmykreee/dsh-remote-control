import type { MediaInfo } from './types';

export function isPlaying(media: MediaInfo | null | undefined): boolean {
  return String(media?.playbackStatus).toLowerCase() === 'playing';
}

export function isSeekable(media: MediaInfo | null | undefined): boolean {
  return Boolean(media?.canSeek) && media?.positionReported === true;
}

export function mediaDuration(media: MediaInfo | null | undefined): number {
  if (!media) return 0;
  return Math.max(0, Number(media.endTime) - Number(media.startTime || 0));
}

export function seekMaximum(media: MediaInfo | null | undefined): number {
  if (!media) return 1;
  return Math.max(1, Number(media.endTime) || 0);
}

/** Same linear projection the original `updateMediaProgress()` applied. */
export function projectedPosition(media: MediaInfo, receivedAt: number, now: number): number {
  const duration = mediaDuration(media);
  let position = Number(media.position) || 0;
  if (isPlaying(media)) position += (now - receivedAt) / 1000;
  position = duration > 0 ? Math.min(duration, Math.max(0, position)) : Math.max(0, position);
  return position;
}

export function clampVolume(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value ?? 0.5)));
}
