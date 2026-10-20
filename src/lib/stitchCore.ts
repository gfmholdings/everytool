// Long-screenshot analysis — pure, dependency-free, unit-tested in Node.
//
// Input: one FrameFeatures per frame (every frame already normalized to
// the same width). Each frame is reduced to a compact per-row signature:
// the luma of FEATURE_COLS sampled columns. Everything below works on
// those signatures, at full row resolution, so a seam lands on the exact
// pixel row — not on a thumbnail row that is 12 px tall at full size.
//
// What the analysis does, in order:
//  1. Drops frames that show the same thing as the previous kept frame
//     (the user paused while recording).
//  2. Finds the fixed header (status bar, nav bar) and fixed footer (tab
//     bar, toolbar, home indicator) shared by consecutive frames.
//     Over-estimating either is safe — the output stays continuous — while
//     under-estimating would repeat a toolbar stripe at every seam, so
//     the largest pairwise estimate wins (capped).
//  3. For each consecutive pair, finds how far the content scrolled (d)
//     inside the region between header and footer: a coarse search on
//     8-row blocks, then a full-resolution refine.
//  4. In recording mode, trims short runs of frames at the start and end
//     that don't connect to the rest (Control Center, the 3-2-1
//     countdown, the stop-recording alert).
//  5. Emits segments: the first frame down to its footer, then only the
//     newly revealed rows of each later frame, then the last frame's
//     footer. Output height is unbounded.
//
// Seams with no credible match are kept, stacked, and counted — never
// hidden.

export const FEATURE_COLS = 48;

export interface FrameFeatures {
  width: number;
  height: number;
  /** height × FEATURE_COLS luma values, row-major. */
  rows: Uint8Array;
}

/**
 * Columns sampled for a row signature: 3%–92% of the width. The right
 * edge is skipped on purpose — iOS draws the scroll indicator there and
 * it moves on every frame.
 */
export function featureColumns(width: number): Int32Array {
  const cols = new Int32Array(FEATURE_COLS);
  const left = width * 0.03;
  const right = width * 0.92;
  for (let i = 0; i < FEATURE_COLS; i += 1) {
    cols[i] = Math.min(
      width - 1,
      Math.max(0, Math.round(left + ((right - left) * i) / (FEATURE_COLS - 1))),
    );
  }
  return cols;
}

/** Builds a FrameFeatures from RGBA rows streamed out of a decoder. */
export class FeatureBuilder {
  readonly width: number;
  readonly height: number;
  private rows: Uint8Array;
  private cols: Int32Array;

  /**
   * @param width  the frame's real width (what the output will be).
   * @param narrow pass true when the rows come from a copy the platform
   *   already cropped to 3%–92% and squeezed to FEATURE_COLS wide (the
   *   app does this natively — ~25× less JS decoding per frame).
   */
  constructor(width: number, height: number, narrow = false) {
    this.width = width;
    this.height = height;
    this.rows = new Uint8Array(height * FEATURE_COLS);
    this.cols = narrow
      ? Int32Array.from({ length: FEATURE_COLS }, (_, i) => i)
      : featureColumns(width);
  }

  addRow(y: number, rgba: Uint8Array): void {
    if (y < 0 || y >= this.height) return;
    const base = y * FEATURE_COLS;
    for (let i = 0; i < FEATURE_COLS; i += 1) {
      const p = this.cols[i]! * 4;
      // Integer Rec. 601 luma.
      this.rows[base + i] =
        (rgba[p]! * 77 + rgba[p + 1]! * 150 + rgba[p + 2]! * 29) >> 8;
    }
  }

  result(): FrameFeatures {
    return { width: this.width, height: this.height, rows: this.rows };
  }
}

/** Mean absolute difference between two row signatures (0–255). */
export function rowDiff(
  a: FrameFeatures,
  ya: number,
  b: FrameFeatures,
  yb: number,
): number {
  const ar = a.rows;
  const br = b.rows;
  const ao = ya * FEATURE_COLS;
  const bo = yb * FEATURE_COLS;
  let sum = 0;
  for (let i = 0; i < FEATURE_COLS; i += 1) {
    const d = ar[ao + i]! - br[bo + i]!;
    sum += d < 0 ? -d : d;
  }
  return sum / FEATURE_COLS;
}

/** Rows whose signatures differ by less than this count as identical.
 *  Generous enough for JPEG/capture noise; scrolled content differs by
 *  far more (tens of levels). */
const SAME_ROW = 4.5;
const HEADER_CAP = 0.35;
const FOOTER_CAP = 0.3;
/** Leading rows that may differ while still finding a header below them
 *  (the status bar clock / recording indicator changes every frame). */
const STATUS_SKIP = 0.08;

/** True when b shows the same picture as a (nothing scrolled). */
export function isDuplicate(a: FrameFeatures, b: FrameFeatures): boolean {
  if (a.height !== b.height || a.width !== b.width) return false;
  // The status area is ignored: its clock / recording pill changes even
  // when nothing else on screen does.
  const from = Math.floor(a.height * STATUS_SKIP);
  let same = 0;
  for (let y = from; y < a.height; y += 1) {
    if (rowDiff(a, y, b, y) < SAME_ROW) same += 1;
  }
  return same / (a.height - from) >= 0.985;
}

/** Height of the fixed area at the top shared by a and b. */
export function staticTop(a: FrameFeatures, b: FrameFeatures): number {
  if (a.height !== b.height) return 0;
  const h = a.height;
  const skipLimit = Math.floor(h * STATUS_SKIP);
  const cap = Math.floor(h * HEADER_CAP);
  // Walk runs of identical rows. Any run that starts within the status
  // area (where a clock or recording pill may differ between frames)
  // extends the header to its end; the first run starting below it, or
  // the first differing row below it, ends the header.
  let header = 0;
  let y = 0;
  while (y < cap) {
    if (rowDiff(a, y, b, y) >= SAME_ROW) {
      if (y >= skipLimit) break;
      y += 1;
      continue;
    }
    const start = y;
    while (y < cap && rowDiff(a, y, b, y) < SAME_ROW) y += 1;
    // A real bar is more than a hairline; a few equal rows is coincidence.
    if (y - start >= 4 || start === 0) header = y;
    if (y < cap && y >= skipLimit) break;
  }
  return header;
}

/** Height of the fixed area at the bottom shared by a and b. */
export function staticBottom(a: FrameFeatures, b: FrameFeatures): number {
  if (a.height !== b.height) return 0;
  const h = a.height;
  const cap = Math.floor(h * FOOTER_CAP);
  let n = 0;
  while (n < cap && rowDiff(a, h - 1 - n, b, h - 1 - n) < SAME_ROW) n += 1;
  return n < 4 ? 0 : n;
}

export interface ScrollMatch {
  /** Rows the content moved up between the frames. */
  d: number;
  /** Mean signature difference over the overlap (lower is better). */
  score: number;
}

/** Above this mean difference a seam is not trusted. */
export const MATCH_THRESHOLD = 9;
const COARSE = 8;

function blockAverage(f: FrameFeatures, from: number, to: number): Float32Array {
  const blocks = Math.floor((to - from) / COARSE);
  const out = new Float32Array(Math.max(0, blocks) * FEATURE_COLS);
  for (let k = 0; k < blocks; k += 1) {
    for (let r = 0; r < COARSE; r += 1) {
      const o = (from + k * COARSE + r) * FEATURE_COLS;
      for (let i = 0; i < FEATURE_COLS; i += 1) {
        out[k * FEATURE_COLS + i]! += f.rows[o + i]!;
      }
    }
    for (let i = 0; i < FEATURE_COLS; i += 1) out[k * FEATURE_COLS + i]! /= COARSE;
  }
  return out;
}

/**
 * How far the content scrolled from a to b, comparing a's rows
 * [aTop, aBot) with b's rows [bTop, bBot): b's row bTop+y shows what a's
 * row aTop+y+d showed. Returns null when no offset matches credibly.
 */
export function findScroll(
  a: FrameFeatures,
  aTop: number,
  aBot: number,
  b: FrameFeatures,
  bTop: number,
  bBot: number,
): ScrollMatch | null {
  const aLen = aBot - aTop;
  const bLen = bBot - bTop;
  if (aLen < COARSE * 4 || bLen < COARSE * 4) return null;
  const minOverlap = Math.max(24, Math.floor(Math.min(aLen, bLen) * 0.08));

  // Coarse: 8-row blocks. A true offset that isn't a multiple of 8 only
  // half-aligns its blocks, so a few best coarse candidates are refined,
  // not just the single best.
  const ab = blockAverage(a, aTop, aBot);
  const bb = blockAverage(b, bTop, bBot);
  const aBlocks = ab.length / FEATURE_COLS;
  const bBlocks = bb.length / FEATURE_COLS;
  const minOvBlocks = Math.max(3, Math.ceil(minOverlap / COARSE));
  const coarse: { k: number; score: number }[] = [];
  const KEEP = 6;
  for (let k = 1; k <= aBlocks - minOvBlocks; k += 1) {
    const n = Math.min(aBlocks - k, bBlocks);
    const worst = coarse.length < KEEP ? Number.POSITIVE_INFINITY : coarse[coarse.length - 1]!.score;
    const budget = worst * n * FEATURE_COLS;
    let sum = 0;
    for (let y = 0; y < n && sum <= budget; y += 1) {
      const ao = (k + y) * FEATURE_COLS;
      const bo = y * FEATURE_COLS;
      for (let i = 0; i < FEATURE_COLS; i += 1) {
        const d = ab[ao + i]! - bb[bo + i]!;
        sum += d < 0 ? -d : d;
      }
    }
    if (sum > budget) continue;
    const score = sum / (n * FEATURE_COLS);
    coarse.push({ k, score });
    coarse.sort((x, y) => x.score - y.score);
    if (coarse.length > KEEP) coarse.pop();
  }
  if (coarse.length === 0) return null;

  // Refine each candidate at full resolution.
  let best: ScrollMatch | null = null;
  const tried = new Set<number>();
  for (const c of coarse) {
    const center = c.k * COARSE;
    for (let d = Math.max(1, center - COARSE - 2); d <= center + COARSE + 2; d += 1) {
      if (tried.has(d)) continue;
      tried.add(d);
      const n = Math.min(aLen - d, bLen);
      if (n < minOverlap) continue;
      const step = n > 600 ? 2 : 1;
      const limit = best ? best.score : Number.POSITIVE_INFINITY;
      let sum = 0;
      let count = 0;
      for (let y = 0; y < n; y += step) {
        sum += rowDiff(a, aTop + d + y, b, bTop + y);
        count += 1;
        // Early out: this offset can no longer beat the best.
        if (count > 16 && sum / count > limit * 4 + 20) break;
      }
      const score = sum / count;
      if (count * step >= n && (!best || score < best.score)) best = { d, score };
    }
  }
  if (!best || best.score > MATCH_THRESHOLD) return null;
  return best;
}

export interface Segment {
  /** Index into the ORIGINAL frames array. */
  frame: number;
  /** Rows [from, to) of that frame, in full-resolution pixels. */
  from: number;
  to: number;
}

export interface StitchAnalysis {
  width: number;
  height: number;
  segments: Segment[];
  /** Original indices of frames that contribute to the image. */
  used: number[];
  /** Frames dropped as unchanged repeats. */
  duplicates: number;
  /** Frames trimmed from the start/end as unconnected (recording mode). */
  trimmed: number;
  /** Seams with no credible overlap — stacked whole, in order. */
  stackedSeams: number;
  header: number;
  footer: number;
}

interface Seam {
  match: ScrollMatch | null;
}

function chromeFor(frames: FrameFeatures[], idx: number[]): { header: number; footer: number } {
  let header = 0;
  let footer = 0;
  for (let i = 1; i < idx.length; i += 1) {
    const a = frames[idx[i - 1]!]!;
    const b = frames[idx[i]!]!;
    header = Math.max(header, staticTop(a, b));
    footer = Math.max(footer, staticBottom(a, b));
  }
  return { header, footer };
}

function seamsFor(
  frames: FrameFeatures[],
  idx: number[],
  header: number,
  footer: number,
): Seam[] {
  const seams: Seam[] = [];
  for (let i = 1; i < idx.length; i += 1) {
    const a = frames[idx[i - 1]!]!;
    const b = frames[idx[i]!]!;
    const aTop = Math.min(header, a.height - 1);
    const bTop = Math.min(header, b.height - 1);
    const aBot = Math.max(aTop + 1, a.height - footer);
    const bBot = Math.max(bTop + 1, b.height - footer);
    seams.push({ match: findScroll(a, aTop, aBot, b, bTop, bBot) });
  }
  return seams;
}

/**
 * Plan a long screenshot. `mode: 'record'` trims unconnected frames at
 * the edges of a screen recording; `'photos'` keeps every picked shot.
 */
export function analyzeFrames(
  frames: FrameFeatures[],
  opts: { mode: 'record' | 'photos' } = { mode: 'photos' },
): StitchAnalysis {
  if (frames.length === 0) {
    return {
      width: 0,
      height: 0,
      segments: [],
      used: [],
      duplicates: 0,
      trimmed: 0,
      stackedSeams: 0,
      header: 0,
      footer: 0,
    };
  }
  const width = frames[0]!.width;
  for (const f of frames) {
    if (f.width !== width) throw new Error('All frames must share one width.');
  }

  // 1. Drop unchanged repeats.
  let idx: number[] = [0];
  let duplicates = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (isDuplicate(frames[idx[idx.length - 1]!]!, frames[i]!)) duplicates += 1;
    else idx.push(i);
  }

  // 2–3. Chrome + seams.
  let { header, footer } = chromeFor(frames, idx);
  let seams = seamsFor(frames, idx, header, footer);

  // 4. Recording mode: trim short unconnected runs at both ends.
  let trimmed = 0;
  if (opts.mode === 'record' && idx.length > 2) {
    const runs: number[][] = [[idx[0]!]];
    for (let i = 1; i < idx.length; i += 1) {
      if (seams[i - 1]!.match) runs[runs.length - 1]!.push(idx[i]!);
      else runs.push([idx[i]!]);
    }
    if (runs.length > 1) {
      const longest = Math.max(...runs.map((r) => r.length));
      while (runs.length > 1 && runs[0]!.length <= 2 && runs[0]!.length < longest) {
        trimmed += runs.shift()!.length;
      }
      while (
        runs.length > 1 &&
        runs[runs.length - 1]!.length <= 2 &&
        runs[runs.length - 1]!.length < longest
      ) {
        trimmed += runs.pop()!.length;
      }
      if (trimmed > 0) {
        idx = runs.flat();
        ({ header, footer } = chromeFor(frames, idx));
        seams = seamsFor(frames, idx, header, footer);
      }
    }
  }

  // Keep at least the region between header and footer meaningful.
  const minHeight = Math.min(...idx.map((i) => frames[i]!.height));
  if (header + footer > minHeight * 0.7) {
    const scale = (minHeight * 0.7) / (header + footer);
    header = Math.floor(header * scale);
    footer = Math.floor(footer * scale);
    seams = seamsFor(frames, idx, header, footer);
  }

  // 5. Segments.
  const segments: Segment[] = [];
  const push = (frame: number, from: number, to: number) => {
    if (to <= from) return;
    const last = segments[segments.length - 1];
    if (last && last.frame === frame && last.to === from) last.to = to;
    else segments.push({ frame, from, to });
  };
  let stackedSeams = 0;
  const used: number[] = [];
  const single = idx.length === 1;
  const first = frames[idx[0]!]!;
  push(idx[0]!, 0, single ? first.height : Math.max(1, first.height - footer));
  used.push(idx[0]!);
  for (let i = 1; i < idx.length; i += 1) {
    const a = frames[idx[i - 1]!]!;
    const b = frames[idx[i]!]!;
    const aTop = Math.min(header, a.height - 1);
    const aBot = Math.max(aTop + 1, a.height - footer);
    const bTop = Math.min(header, b.height - 1);
    const bBot = Math.max(bTop + 1, b.height - footer);
    const m = seams[i - 1]!.match;
    if (m) {
      const from = bTop + (aBot - aTop) - m.d;
      if (from < bBot) {
        push(idx[i]!, Math.max(bTop, from), bBot);
        used.push(idx[i]!);
      }
    } else {
      stackedSeams += 1;
      push(idx[i]!, bTop, bBot);
      used.push(idx[i]!);
    }
  }
  if (!single) {
    const lastIdx = idx[idx.length - 1]!;
    const last = frames[lastIdx]!;
    push(lastIdx, Math.max(0, last.height - footer), last.height);
    if (!used.includes(lastIdx)) used.push(lastIdx);
  }

  const height = segments.reduce((n, s) => n + (s.to - s.from), 0);
  return {
    width,
    height,
    segments,
    used,
    duplicates,
    trimmed,
    stackedSeams,
    header,
    footer,
  };
}

/**
 * Stream the planned segments into a row writer. `decode` must deliver
 * the frame's RGBA rows in order (it may stop after `stopAfterRow`). Each
 * frame is decoded once, in segment order, so memory stays at one frame.
 */
export async function emitSegments(
  analysis: StitchAnalysis,
  decode: (
    frame: number,
    onRow: (y: number, rgba: Uint8Array) => void,
    stopAfterRow: number,
  ) => Promise<void>,
  writeRow: (rgba: Uint8Array) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let written = 0;
  const total = analysis.segments.length;
  for (let i = 0; i < total; i += 1) {
    const seg = analysis.segments[i]!;
    await decode(
      seg.frame,
      (y, rgba) => {
        if (y >= seg.from && y < seg.to) {
          writeRow(rgba);
          written += 1;
        }
      },
      seg.to - 1,
    );
    onProgress?.(i + 1, total);
  }
  return written;
}
