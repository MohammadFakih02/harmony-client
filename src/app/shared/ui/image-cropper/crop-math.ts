/**
 * Pure geometry for the image-cropper modal — every calculation the component does lives here so
 * it can be unit-tested without a canvas or DOM. All rects are `{ x, y, w, h }`; "display" space is
 * the letterboxed on-screen image, "natural" space is the source bitmap's pixel grid.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The largest rect of the given aspect ratio (w / h) that fits an `imgW`×`imgH` image, centred.
 */
export function initialCropRect(imgW: number, imgH: number, aspect: number): CropRect {
  let w = imgW;
  let h = w / aspect;
  if (h > imgH) {
    h = imgH;
    w = h * aspect;
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

/**
 * Clamps a rect into the image bounds: size first (capped to the image, aspect preserved via the
 * caller keeping w/h consistent), then position.
 */
export function clampRect(rect: CropRect, imgW: number, imgH: number): CropRect {
  const w = Math.min(rect.w, imgW);
  const h = Math.min(rect.h, imgH);
  const x = Math.min(Math.max(rect.x, 0), imgW - w);
  const y = Math.min(Math.max(rect.y, 0), imgH - h);
  return { x, y, w, h };
}

/**
 * Scales the rect about its own centre by `factor`, preserving `aspect`, bounded to
 * [minW … the largest aspect-true size that fits the image]. The centre only moves if the
 * grown rect must slide back inside the bounds.
 */
export function scaleRectAboutCenter(
  rect: CropRect,
  factor: number,
  aspect: number,
  imgW: number,
  imgH: number,
  minW = 32,
): CropRect {
  const maxW = Math.min(imgW, imgH * aspect);
  const w = Math.min(Math.max(rect.w * factor, Math.min(minW, maxW)), maxW);
  const h = w / aspect;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, imgW, imgH);
}

/** Maps a display-space rect to natural (source-pixel) space. `scale` = natural / display. */
export function displayToNatural(rect: CropRect, scale: number): CropRect {
  return { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale };
}

/**
 * Output canvas size for a natural-space crop: capped at `outputWidth` but never upscaled past
 * the source pixels; height follows the aspect. Always at least 1×1.
 */
export function exportSize(
  naturalRect: CropRect,
  outputWidth: number,
  aspect: number,
): { w: number; h: number } {
  const w = Math.max(1, Math.round(Math.min(outputWidth, naturalRect.w)));
  const h = Math.max(1, Math.round(w / aspect));
  return { w, h };
}
