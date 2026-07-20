import {
  clampRect,
  displayToNatural,
  exportSize,
  initialCropRect,
  scaleRectAboutCenter,
} from './crop-math';

describe('crop-math', () => {
  describe('initialCropRect', () => {
    it('spans the full width of a wide image for a square crop, centred vertically', () => {
      expect(initialCropRect(400, 800, 1)).toEqual({ x: 0, y: 200, w: 400, h: 400 });
    });

    it('spans the full height of a tall crop on a wide image, centred horizontally', () => {
      // 3.5:1 banner crop on an 800×100 strip: height-limited.
      expect(initialCropRect(800, 100, 3.5)).toEqual({ x: 225, y: 0, w: 350, h: 100 });
    });

    it('fills a square image exactly with a square crop', () => {
      expect(initialCropRect(500, 500, 1)).toEqual({ x: 0, y: 0, w: 500, h: 500 });
    });
  });

  describe('clampRect', () => {
    it('slides an out-of-bounds rect back inside without resizing it', () => {
      expect(clampRect({ x: -20, y: 350, w: 100, h: 100 }, 400, 400)).toEqual({
        x: 0,
        y: 300,
        w: 100,
        h: 100,
      });
    });

    it('leaves an in-bounds rect untouched', () => {
      const r = { x: 10, y: 20, w: 50, h: 50 };
      expect(clampRect(r, 400, 400)).toEqual(r);
    });
  });

  describe('scaleRectAboutCenter', () => {
    it('grows about the centre, preserving the aspect', () => {
      const r = scaleRectAboutCenter({ x: 150, y: 150, w: 100, h: 100 }, 2, 1, 400, 400);
      expect(r).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    });

    it('never grows past the largest aspect-true size that fits', () => {
      const r = scaleRectAboutCenter({ x: 0, y: 0, w: 300, h: 300 }, 10, 1, 400, 350);
      expect(r.w).toBe(350);
      expect(r.h).toBe(350);
    });

    it('never shrinks below the minimum width', () => {
      const r = scaleRectAboutCenter({ x: 0, y: 0, w: 40, h: 40 }, 0.01, 1, 400, 400, 32);
      expect(r.w).toBe(32);
    });

    it('slides back inside the bounds when growing near an edge', () => {
      const r = scaleRectAboutCenter({ x: 350, y: 350, w: 50, h: 50 }, 3, 1, 400, 400);
      expect(r.x + r.w).toBeLessThanOrEqual(400);
      expect(r.y + r.h).toBeLessThanOrEqual(400);
      expect(r.w).toBe(150);
    });
  });

  describe('displayToNatural', () => {
    it('round-trips a display rect through the natural scale factor', () => {
      const display = { x: 10, y: 20, w: 100, h: 100 };
      const natural = displayToNatural(display, 4); // 1600px image shown at 400px
      expect(natural).toEqual({ x: 40, y: 80, w: 400, h: 400 });
      expect(displayToNatural(natural, 1 / 4)).toEqual(display);
    });
  });

  describe('exportSize', () => {
    it('caps at the output width when the source region is larger', () => {
      expect(exportSize({ x: 0, y: 0, w: 2000, h: 2000 }, 512, 1)).toEqual({ w: 512, h: 512 });
    });

    it('never upscales a region smaller than the output width', () => {
      expect(exportSize({ x: 0, y: 0, w: 300, h: 300 }, 512, 1)).toEqual({ w: 300, h: 300 });
    });

    it('derives the height from the aspect', () => {
      expect(exportSize({ x: 0, y: 0, w: 3500, h: 1000 }, 1280, 3.5)).toEqual({ w: 1280, h: 366 });
    });

    it('is never smaller than 1×1', () => {
      expect(exportSize({ x: 0, y: 0, w: 0.4, h: 0.4 }, 512, 1)).toEqual({ w: 1, h: 1 });
    });
  });
});
