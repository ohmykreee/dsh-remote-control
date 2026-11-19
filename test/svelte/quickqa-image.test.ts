import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  companionScreenshotApi,
  quickQaImageMediaType,
  quickQaImageSource,
  readCompanionImage,
} from '../../src/svelte/lib/quickqa-image.ts';

function stubCompanion(api: unknown): void {
  vi.stubGlobal('window', { __DSH_COMPANION__: api });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quickQaImageMediaType', () => {
  it('accepts the four supported image MIME types', () => {
    expect(quickQaImageMediaType('image/png')).toBe('image/png');
    expect(quickQaImageMediaType('image/jpeg')).toBe('image/jpeg');
    expect(quickQaImageMediaType('image/webp')).toBe('image/webp');
    expect(quickQaImageMediaType('image/gif')).toBe('image/gif');
  });

  it('normalizes case and MIME parameters', () => {
    expect(quickQaImageMediaType('IMAGE/PNG; charset=binary')).toBe('image/png');
  });

  it('falls back to a known filename extension', () => {
    expect(quickQaImageMediaType('photo.JPG')).toBe('image/jpeg');
    expect(quickQaImageMediaType('scan.jpeg')).toBe('image/jpeg');
    expect(quickQaImageMediaType('anim.webp')).toBe('image/webp');
  });

  it('rejects unsupported types and empty input', () => {
    expect(quickQaImageMediaType('image/bmp')).toBeNull();
    expect(quickQaImageMediaType('text/plain')).toBeNull();
    expect(quickQaImageMediaType('photo.bmp')).toBeNull();
    expect(quickQaImageMediaType('')).toBeNull();
    expect(quickQaImageMediaType(undefined)).toBeNull();
  });
});

describe('companion screenshot bridge', () => {
  it('is absent in a plain browser', async () => {
    expect(companionScreenshotApi()).toBeNull();
    expect(quickQaImageSource()).toBe('clipboard');
    await expect(readCompanionImage()).resolves.toBeNull();
  });

  it('ignores a window object without a usable capture method', () => {
    vi.stubGlobal('window', {});
    expect(quickQaImageSource()).toBe('clipboard');
    stubCompanion({ version: 1 });
    expect(companionScreenshotApi()).toBeNull();
    expect(quickQaImageSource()).toBe('clipboard');
  });

  it('prefers the companion capture and returns its PNG Blob', async () => {
    const capture = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    stubCompanion({
      version: 1,
      platform: 'windows',
      capabilities: { vrScreenshot: true },
      captureVrScreenshot: capture,
    });
    expect(companionScreenshotApi()).not.toBeNull();
    expect(quickQaImageSource()).toBe('companion');
    const image = await readCompanionImage();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(image?.blob.type).toBe('image/png');
    expect(image?.mediaType).toBe('image/png');
  });

  it('falls back to PNG when the captured Blob carries no media type', async () => {
    stubCompanion({ captureVrScreenshot: async () => new Blob(['png']) });
    const image = await readCompanionImage();
    expect(image?.mediaType).toBe('image/png');
  });

  it('propagates a failed capture instead of falling back to the clipboard', async () => {
    const capture = vi.fn(async () => {
      throw new Error('SteamVR is not running');
    });
    stubCompanion({ captureVrScreenshot: capture });
    await expect(readCompanionImage()).rejects.toThrow('SteamVR is not running');
  });
});
