import { describe, expect, it } from 'vitest';
import { quickQaImageMediaType } from '../../src/svelte/lib/quickqa-image.ts';

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
