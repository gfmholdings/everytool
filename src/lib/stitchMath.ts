// Stitch planning — the sizing rules that keep a long screenshot usable,
// learned from the mockup bug the owner hit: three full-res camera photos
// (4284 × 5712 each) stitched at natural size produced a 4284 × 17136
// canvas that phones refuse to draw. So: normalize every source to a
// phone-screenshot width BEFORE stitching, and cap the finished height,
// scaling the whole strip down proportionally if it would exceed it.

export const STITCH_MAX_WIDTH = 1170;
export const STITCH_MAX_HEIGHT = 8192;

export interface Size {
  width: number;
  height: number;
}

/** The working width for a set of shots: the narrowest shot, capped. */
export function stitchWidth(sizes: Size[]): number {
  if (sizes.length === 0) return 0;
  return Math.min(STITCH_MAX_WIDTH, ...sizes.map((s) => s.width));
}

/** A source's height once resized to `width` (aspect preserved). */
export function scaledHeight(size: Size, width: number): number {
  if (size.width <= 0) return 0;
  return Math.max(1, Math.round((size.height * width) / size.width));
}

export interface StitchPlan {
  width: number;
  /** Where each shot's top lands in the output, before final capping. */
  offsetsY: number[];
  naturalHeight: number;
  /** Final dimensions after the height cap is applied. */
  height: number;
  outWidth: number;
  /** True when the strip had to be shrunk to fit the height cap. */
  capped: boolean;
  /** True when at least one seam found no credible overlap. */
  stacked: boolean;
}

/**
 * Plan a stitch. `overlaps[i]` is the verified overlap (in scaled pixels)
 * between the running image and shot i+1; pass 0 when a seam had no match —
 * the caller reports that honestly instead of hiding it.
 */
export function planStitch(sizes: Size[], overlaps: number[]): StitchPlan {
  const width = stitchWidth(sizes);
  const offsetsY: number[] = [];
  let cursor = 0;
  sizes.forEach((size, i) => {
    if (i === 0) {
      offsetsY.push(0);
      cursor = scaledHeight(size, width);
    } else {
      const overlap = Math.max(0, Math.min(overlaps[i - 1] ?? 0, cursor - 1));
      offsetsY.push(cursor - overlap);
      cursor += scaledHeight(size, width) - overlap;
    }
  });
  const naturalHeight = cursor;
  if (naturalHeight > STITCH_MAX_HEIGHT) {
    const scale = STITCH_MAX_HEIGHT / naturalHeight;
    return {
      width,
      offsetsY,
      naturalHeight,
      height: STITCH_MAX_HEIGHT,
      outWidth: Math.max(1, Math.round(width * scale)),
      capped: true,
      stacked: overlaps.some((o) => o <= 0),
    };
  }
  return {
    width,
    offsetsY,
    naturalHeight,
    height: naturalHeight,
    outWidth: width,
    capped: false,
    stacked: overlaps.some((o) => o <= 0),
  };
}
