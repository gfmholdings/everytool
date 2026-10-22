// Stitch sizing. Every source is normalized to a phone-screenshot width
// BEFORE stitching (three 4284 × 5712 camera photos at natural size made
// a canvas phones refuse to draw). Phone screenshots (up to 1320 px on
// current iPhones) are NOT scaled: a fractional resize blends rows, and
// the stitch then cuts through that blend, which draws a line at every
// join. There is deliberately NO height cap: the stitcher streams rows
// into a compressed PNG on disk, so a long screenshot is as long as the
// user scrolled. Planning lives in stitchCore.ts.

export const STITCH_MAX_WIDTH = 1320;

export interface Size {
  width: number;
  height: number;
}

/** The working width for a set of shots: the narrowest shot, capped. */
export function stitchWidth(sizes: Size[]): number {
  const widths = sizes.map((s) => s.width).filter((w) => w > 0);
  if (widths.length === 0) return 0;
  return Math.min(STITCH_MAX_WIDTH, ...widths);
}

/** A source's height once resized to `width` (aspect preserved). */
export function scaledHeight(size: Size, width: number): number {
  if (size.width <= 0) return 0;
  return Math.max(1, Math.round((size.height * width) / size.width));
}

/**
 * Pixel height of source rows [from, to) drawn at `scale`.
 * Both edges are rounded, so stacked segments meet on integer pixels:
 * no fractional clip, no 1px gap, and no extra source row in the join.
 */
export function previewSpan(from: number, to: number, scale: number): number {
  if (!(scale > 0) || to <= from) return 0;
  return Math.round(to * scale) - Math.round(from * scale);
}
