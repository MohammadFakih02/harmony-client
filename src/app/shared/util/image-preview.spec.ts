import { describe, it, expect, vi } from 'vitest';
import { buildSrcset, blurhashToDataUrl } from './image-preview';

describe('buildSrcset', () => {
  it('returns null when there are no variants', () => {
    expect(buildSrcset(null)).toBeNull();
    expect(buildSrcset(undefined)).toBeNull();
    expect(buildSrcset([])).toBeNull();
  });

  it('builds an ascending-by-width "url Nw" list', () => {
    expect(
      buildSrcset([
        { url: 'https://x/w800', width: 800 },
        { url: 'https://x/w400', width: 400 },
        { url: 'https://x/w1200', width: 1200 },
      ]),
    ).toBe('https://x/w400 400w, https://x/w800 800w, https://x/w1200 1200w');
  });
});

describe('blurhashToDataUrl', () => {
  // The canonical example hash from the blurhash readme.
  const VALID = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

  it('returns null on an invalid hash (never throws)', () => {
    expect(blurhashToDataUrl('not-a-hash', 100, 100)).toBeNull();
  });

  it('returns null when the host has no 2D canvas (jsdom / SSR)', () => {
    const doc = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;
    expect(blurhashToDataUrl(VALID, 100, 100, doc)).toBeNull();
  });

  it('decodes to a data URL when a 2D context is available', () => {
    const putImageData = vi.fn();
    let sampleW = 0;
    let sampleH = 0;
    const doc = {
      createElement: () => ({
        set width(v: number) {
          sampleW = v;
        },
        set height(v: number) {
          sampleH = v;
        },
        getContext: () => ({
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData,
        }),
        toDataURL: () => 'data:image/png;base64,AAAA',
      }),
    } as unknown as Document;

    // A 2:1 landscape box → the sample canvas keeps that aspect (height = half the width).
    expect(blurhashToDataUrl(VALID, 200, 100, doc)).toBe('data:image/png;base64,AAAA');
    expect(putImageData).toHaveBeenCalledOnce();
    expect(sampleW).toBe(32);
    expect(sampleH).toBe(16);
  });
});
