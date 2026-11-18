import { describe, expect, it } from 'vitest';
import {
  clampVolume,
  isPlaying,
  isSeekable,
  mediaDuration,
  seekMaximum,
} from '../../src/svelte/lib/media.ts';

describe('isPlaying', () => {
  it('only accepts the playing status, case-insensitively', () => {
    expect(isPlaying({ playbackStatus: 'playing' })).toBe(true);
    expect(isPlaying({ playbackStatus: 'Playing' })).toBe(true);
    expect(isPlaying({ playbackStatus: 'paused' })).toBe(false);
    expect(isPlaying({})).toBe(false);
    expect(isPlaying(null)).toBe(false);
    expect(isPlaying(undefined)).toBe(false);
  });
});

describe('isSeekable', () => {
  it('needs both the capability and a reported position', () => {
    expect(isSeekable({ canSeek: true, positionReported: true })).toBe(true);
    expect(isSeekable({ canSeek: false, positionReported: true })).toBe(false);
    expect(isSeekable({ canSeek: true })).toBe(false);
    expect(isSeekable({ canSeek: true, positionReported: false })).toBe(false);
    expect(isSeekable(null)).toBe(false);
  });
});

describe('mediaDuration', () => {
  it('is the clamped end minus start', () => {
    expect(mediaDuration({ startTime: 0, endTime: 120 })).toBe(120);
    expect(mediaDuration({ startTime: 30, endTime: 120 })).toBe(90);
    expect(mediaDuration({ startTime: 120, endTime: 30 })).toBe(0);
    expect(mediaDuration({ endTime: 120 })).toBe(120);
    expect(mediaDuration(null)).toBe(0);
  });
});

describe('seekMaximum', () => {
  it('never returns zero or a negative value', () => {
    expect(seekMaximum({ endTime: 120 })).toBe(120);
    expect(seekMaximum({ endTime: 0 })).toBe(1);
    expect(seekMaximum({})).toBe(1);
    expect(seekMaximum(null)).toBe(1);
  });
});

describe('clampVolume', () => {
  it('keeps the input inside 0..1 and defaults to 50%', () => {
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1.7)).toBe(1);
    expect(clampVolume(-0.3)).toBe(0);
    expect(clampVolume('0.25')).toBe(0.25);
    expect(clampVolume(undefined)).toBe(0.5);
    expect(clampVolume(null)).toBe(0.5);
  });
});
