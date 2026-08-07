import { decode } from 'blurhash';
import { ImageVariant } from '../../core/models/file.models';

// Small helpers for A6 image rendering: a BlurHash → data-URL placeholder and a responsive
// srcset attribute builder. Kept out of the component so the pure part (buildSrcset) is unit-tested
// and the canvas part fails soft on hosts without 2D canvas (jsdom / SSR).

/** Max decoded dimension for the blur placeholder — it's scaled up by `background-size: cover`, so
 *  a tiny canvas is plenty and keeps the decode cheap. */
const BLUR_SAMPLE = 32;

/**
 * Decodes a BlurHash into a `data:` PNG URL for use as a CSS background placeholder. Returns null
 * on any failure (invalid hash, no 2D canvas) so the caller just renders its neutral box instead.
 * The sample canvas keeps the source aspect ratio so `cover` doesn't distort the blur.
 */
export function blurhashToDataUrl(
  hash: string,
  width: number,
  height: number,
  doc: Document = document,
): string | null {
  try {
    const w = BLUR_SAMPLE;
    const ratio = width > 0 && height > 0 ? height / width : 1;
    const h = Math.max(1, Math.min(BLUR_SAMPLE, Math.round(BLUR_SAMPLE * ratio)));
    const pixels = decode(hash, w, h, 1);
    const canvas = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(w, h);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

/**
 * Builds an `<img srcset>` attribute value from the presigned WebP variants — `"<url> <width>w, …"`
 * ascending. Returns null when there are no variants (the caller then relies on `src` alone).
 */
export function buildSrcset(variants: readonly ImageVariant[] | null | undefined): string | null {
  if (!variants || variants.length === 0) return null;
  return [...variants]
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');
}
