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

export function clampVolume(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value ?? 0.5)));
}
