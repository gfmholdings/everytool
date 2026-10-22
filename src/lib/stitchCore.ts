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
//  6. Finds regions that stay put in screen coordinates while the content
//     scrolls (a floating compose button, a sticky bar the footer missed).
//     Those pixels are dropped from every appended slice. The header stays
//     from the first frame; the footer and floating overlays are taken
//     from the last frame. Content a button covered is filled from another
//     frame where that row had scrolled clear of it.
//
// Seams with no credible match are kept, stacked, and counted — never
// hidden.

export const FEATURE_COLS = 48;
/** Right-edge samples (72%–100% of the width). Not used for scroll
 *  matching — the scroll indicator lives here — but a floating button
 *  does too, and row signatures that stop at 92% never see it. */
export const EDGE_COLS = 24;

export interface FrameFeatures {
  width: number;
  height: number;
  /** height × FEATURE_COLS luma values, row-major. */
  rows: Uint8Array;
  /** Pixel x of each feature column. */
  colX: Int32Array;
  /** height × EDGE_COLS luma for the right edge. */
  edge: Uint8Array;
  /** Pixel x of each edge column. */
  edgeX: Int32Array;
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

/** Pixel x of each sample in a right-edge strip resized to EDGE_COLS. */
export function edgeXsForCrop(width: number, originX: number, cropWidth: number): Int32Array {
  const xs = new Int32Array(EDGE_COLS);
  const span = Math.max(1, cropWidth);
  for (let i = 0; i < EDGE_COLS; i += 1) {
    xs[i] = Math.min(width - 1, Math.max(0, Math.round(originX + ((i + 0.5) * span) / EDGE_COLS)));
  }
  return xs;
}

/** Right-edge sample positions on a full-width frame (tests, and the
 *  fallback before a resized strip replaces them). */
export function edgeColumns(width: number): Int32Array {
  const left = width * 0.72;
  const right = Math.max(left, width - 1);
  return edgeXsForCrop(width, left, right - left);
}

/** Pixel x each narrowed feature column represents (3%–92%, resized). */
export function narrowFeatureXs(width: number): Int32Array {
  const originX = Math.floor(width * 0.03);
  const cropWidth = Math.max(FEATURE_COLS, Math.floor(width * 0.89));
  const xs = new Int32Array(FEATURE_COLS);
  for (let i = 0; i < FEATURE_COLS; i += 1) {
    xs[i] = Math.min(width - 1, Math.max(0, Math.round(originX + ((i + 0.5) * cropWidth) / FEATURE_COLS)));
  }
  return xs;
}

function lumaOf(rgba: Uint8Array, pixel: number): number {
  const p = pixel * 4;
  return (rgba[p]! * 77 + rgba[p + 1]! * 150 + rgba[p + 2]! * 29) >> 8;
}

/** Builds a FrameFeatures from RGBA rows streamed out of a decoder. */
export class FeatureBuilder {
  readonly width: number;
  readonly height: number;
  private rows: Uint8Array;
  private cols: Int32Array;
  private colX: Int32Array;
  private edge: Uint8Array;
  private edgeX: Int32Array;
  private readonly narrow: boolean;

  /**
   * @param width  the frame's real width (what the output will be).
   * @param narrow pass true when the rows come from a copy the platform
   *   already cropped to 3%–92% and squeezed to FEATURE_COLS wide (the
   *   app does this natively — ~25× less JS decoding per frame). The
   *   right edge is then filled with {@link addEdgeRow}.
   */
  constructor(width: number, height: number, narrow = false) {
    this.width = width;
    this.height = height;
    this.narrow = narrow;
    this.rows = new Uint8Array(height * FEATURE_COLS);
    this.colX = narrow ? narrowFeatureXs(width) : featureColumns(width);
    this.cols = narrow ? Int32Array.from({ length: FEATURE_COLS }, (_, i) => i) : this.colX;
    this.edge = new Uint8Array(height * EDGE_COLS);
    this.edgeX = edgeColumns(width);
  }

  /** Real pixel x for an already-resized right-edge strip. */
  setEdgeXs(xs: Int32Array): void {
    if (xs.length === EDGE_COLS) this.edgeX = xs;
  }

  addRow(y: number, rgba: Uint8Array): void {
    if (y < 0 || y >= this.height) return;
    const base = y * FEATURE_COLS;
    for (let i = 0; i < FEATURE_COLS; i += 1) {
      this.rows[base + i] = lumaOf(rgba, this.cols[i]!);
    }
    if (!this.narrow) {
      const eb = y * EDGE_COLS;
      for (let i = 0; i < EDGE_COLS; i += 1) {
        this.edge[eb + i] = lumaOf(rgba, this.edgeX[i]!);
      }
    }
  }

  /** One row of the resized right-edge strip (EDGE_COLS pixels wide). */
  addEdgeRow(y: number, rgba: Uint8Array): void {
    if (y < 0 || y >= this.height) return;
    const eb = y * EDGE_COLS;
    for (let i = 0; i < EDGE_COLS; i += 1) {
      this.edge[eb + i] = lumaOf(rgba, i);
    }
  }

  result(): FrameFeatures {
    return {
      width: this.width,
      height: this.height,
      rows: this.rows,
      colX: this.colX,
      edge: this.edge,
      edgeX: this.edgeX,
    };
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
  /** Column ranges copied from another frame so a static overlay does not
   *  eat the scrolling content. Output-row coordinates. */
  repairs: ColumnRepair[];
  /** The one copy of each floating overlay, taken from the last frame. */
  stamps: OverlayStamp[];
}

/** A vertical run of columns replaced with pixels from another frame. */
export interface ColumnRepair {
  outY0: number;
  outY1: number;
  x0: number;
  x1: number;
  frame: number;
  /** Row in `frame` that supplies outY0; the run is contiguous. */
  srcY0: number;
}

/** Screen-fixed overlay painted once, from the last frame of its run. */
export interface OverlayStamp {
  outX: number;
  outY: number;
  width: number;
  height: number;
  frame: number;
  srcX: number;
  srcY: number;
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

interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Sample {
  x: number;
  /** Column index into either the feature grid or the edge grid. */
  kind: 'main' | 'edge';
  i: number;
}

function sampleLuma(f: FrameFeatures, y: number, s: Sample): number {
  if (y < 0 || y >= f.height) return 0;
  if (s.kind === 'main') return f.rows[y * FEATURE_COLS + s.i] ?? 0;
  return f.edge[y * EDGE_COLS + s.i] ?? 0;
}

function samplesFor(f: FrameFeatures): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < f.colX.length; i += 1) out.push({ x: f.colX[i]!, kind: 'main', i });
  if (f.edge.length >= f.height * EDGE_COLS && f.edgeX.length === EDGE_COLS) {
    for (let i = 0; i < EDGE_COLS; i += 1) out.push({ x: f.edgeX[i]!, kind: 'edge', i });
  }
  out.sort((a, b) => a.x - b.x || (a.kind === b.kind ? a.i - b.i : a.kind === 'main' ? -1 : 1));
  const dedup: Sample[] = [];
  for (const s of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(prev.x - s.x) <= 1) continue;
    dedup.push(s);
  }
  return dedup;
}

const SAMPLE_SAME = 12;
const SAMPLE_MOVED = 22;

/**
 * Rectangles that stay fixed on the screen while the page scrolls.
 * Full-width bars already claimed as header or footer are left out;
 * what remains is a floating button or a sticky strip between them.
 */
function detectOverlays(
  frames: FrameFeatures[],
  idx: number[],
  seams: Seam[],
  header: number,
  footer: number,
): ScreenRect[] {
  if (idx.length < 2) return [];
  const base = frames[idx[0]!];
  if (!base) return [];
  const height = base.height;
  const width = base.width;
  const samples = samplesFor(base);
  const n = samples.length;
  if (n === 0 || height === 0) return [];
  const votes = new Uint16Array(height * n);
  const comps = new Uint16Array(height * n);
  const top = header;
  const bot = height - footer;
  if (bot - top < 16) return [];

  for (let p = 1; p < idx.length; p += 1) {
    const match = seams[p - 1]?.match;
    if (!match || match.d < 1) continue;
    const a = frames[idx[p - 1]!];
    const b = frames[idx[p]!];
    if (!a || !b || a.height !== height || b.height !== height) continue;
    const d = match.d;
    const sameD = new Int16Array(n);
    const movedD = new Int16Array(n);
    for (let y = top; y < bot; y += 1) {
      const ay = y + d;
      if (ay < top || ay >= bot) continue;
      let scrollers = 0;
      for (let s = 0; s < n; s += 1) {
        const sample = samples[s]!;
        const same = Math.abs(sampleLuma(a, y, sample) - sampleLuma(b, y, sample));
        const moved = Math.abs(sampleLuma(a, ay, sample) - sampleLuma(b, y, sample));
        sameD[s] = same;
        movedD[s] = moved;
        if (moved <= SAMPLE_SAME && same >= SAMPLE_MOVED) scrollers += 1;
      }
      // The row is scrolling content when most columns follow the scroll.
      // A column that stays put anyway is an overlay — even when the
      // scrolled lookup still lands on the overlay (the button is taller
      // than this step) — but a column that ALSO matches the scroll is
      // just flat content (white margin) and is left alone.
      const rowScrolled = scrollers * 2 >= n;
      const row = y * n;
      for (let s = 0; s < n; s += 1) {
        comps[row + s] = (comps[row + s] ?? 0) + 1;
        const same = sameD[s] ?? 0;
        const moved = movedD[s] ?? 0;
        const stays = same <= SAMPLE_SAME && moved > SAMPLE_SAME;
        if (stays && (moved >= SAMPLE_MOVED || rowScrolled)) {
          votes[row + s] = (votes[row + s] ?? 0) + 1;
        }
      }
    }
  }

  const mask = new Uint8Array(height * n);
  for (let i = 0; i < mask.length; i += 1) {
    const c = comps[i] ?? 0;
    const v = votes[i] ?? 0;
    // Unanimous across the pairs that could see this cell. One agreeing
    // pair is enough when that's all there is; noise doesn't survive
    // every pair of a real recording.
    if (c > 0 && v === c) mask[i] = 1;
  }

  const seen = new Uint8Array(height * n);
  const rects: ScreenRect[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let minS = n;
    let maxS = 0;
    let minY = height;
    let maxY = 0;
    let count = 0;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const y = Math.floor(cur / n);
      const s = cur - y * n;
      count += 1;
      if (s < minS) minS = s;
      if (s > maxS) maxS = s;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [s - 1, s + 1];
      for (const ns of neighbors) {
        if (ns < 0 || ns >= n) continue;
        if (Math.abs(samples[ns]!.x - samples[s]!.x) > 28) continue;
        const ni = y * n + ns;
        if (mask[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        const ni = ny * n + s;
        if (mask[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const spanY = maxY - minY + 1;
    const x0s = samples[minS]!.x;
    const x1s = samples[maxS]!.x;
    if (count < 12 || spanY < 10 || x1s - x0s < 12) continue;
    const cols = maxS - minS + 1;
    if (count / (spanY * cols) < 0.3) continue;
    rects.push({ x0: x0s, y0: minY, x1: x1s + 1, y1: maxY + 1 });
  }

  // Merge pieces of one button that a low-contrast row split apart.
  const merged: ScreenRect[] = [];
  for (const r of rects) {
    let absorbed = false;
    for (const m of merged) {
      const gapX = Math.max(0, Math.max(r.x0, m.x0) - Math.min(r.x1, m.x1));
      const gapY = Math.max(0, Math.max(r.y0, m.y0) - Math.min(r.y1, m.y1));
      if (gapX <= 10 && gapY <= 8) {
        m.x0 = Math.min(m.x0, r.x0);
        m.y0 = Math.min(m.y0, r.y0);
        m.x1 = Math.max(m.x1, r.x1);
        m.y1 = Math.max(m.y1, r.y1);
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push({ ...r });
  }

  // The vote above misses button rows whose scrolled partner is still
  // the button, or is already off the bottom of the frame. Once a
  // column band is known to be an overlay, grow it through every row
  // where those columns simply don't change.
  const staysPut = (y: number, x0: number, x1: number): boolean => {
    let pairs = 0;
    for (let p = 1; p < idx.length; p += 1) {
      const match = seams[p - 1]?.match;
      if (!match || match.d < 1) continue;
      const a = frames[idx[p - 1]!];
      const b = frames[idx[p]!];
      if (!a || !b || a.height !== height || b.height !== height) continue;
      let checked = 0;
      let held = 0;
      let differed = 0;
      const ay = y + match.d;
      const canScroll = ay >= top && ay < bot;
      for (const sample of samples) {
        if (sample.x < x0 || sample.x >= x1) continue;
        checked += 1;
        const same = Math.abs(sampleLuma(a, y, sample) - sampleLuma(b, y, sample));
        if (same <= SAMPLE_SAME) held += 1;
        if (canScroll) {
          const moved = Math.abs(sampleLuma(a, ay, sample) - sampleLuma(b, y, sample));
          // Flat content (a white margin) matches the scroll too. An
          // overlay does not — the page underneath has moved.
          if (moved > SAMPLE_SAME) differed += 1;
        }
      }
      if (checked === 0) continue;
      pairs += 1;
      if (held * 5 < checked * 4) return false;
      if (canScroll && differed * 2 < checked) return false;
    }
    return pairs > 0;
  };
  for (const r of merged) {
    const votedY0 = r.y0;
    const votedY1 = r.y1;
    // Don't walk a white margin the length of the page. A button or
    // toolbar that the vote split is only a short gap past the voted rows.
    const limit = 48;
    while (r.y0 > top && votedY0 - r.y0 < limit && staysPut(r.y0 - 1, r.x0, r.x1)) r.y0 -= 1;
    while (r.y1 < bot && r.y1 - votedY1 < limit && staysPut(r.y1, r.x0, r.x1)) r.y1 += 1;
  }
  // Extension can close a gap the vote left in the middle of one button.
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i]!;
        const b = merged[j]!;
        const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
        const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        if (gapX <= 12 && gapY <= 16) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          merged.splice(j, 1);
          grew = true;
          break;
        }
      }
      if (grew) break;
    }
  }

  const contentH = bot - top;
  const out: ScreenRect[] = [];
  for (const r of merged) {
    const padX = 8;
    let x0 = Math.max(0, r.x0 - padX);
    let x1 = Math.min(width, r.x1 + padX);
    if (width - x1 <= 12 && x1 > width * 0.8) x1 = width;
    const y0 = Math.max(top, r.y0 - 2);
    const y1 = Math.min(bot, r.y1 + 2);
    if (y1 - y0 < 10 || x1 - x0 < 14) continue;
    // A region covering most of the screen is a bad mask, not a button
    // or a toolbar. Full-width bars are already the header and footer.
    if (y1 - y0 > height * 0.4) continue;
    if (x1 - x0 > width * 0.92 && y1 - y0 > contentH * 0.45) continue;
    out.push({ x0, y0, x1, y1 });
  }
  return out;
}

function planOverlayFix(
  frames: FrameFeatures[],
  idx: number[],
  seams: Seam[],
  header: number,
  footer: number,
  segments: Segment[],
): { repairs: ColumnRepair[]; stamps: OverlayStamp[] } {
  const empty = { repairs: [] as ColumnRepair[], stamps: [] as OverlayStamp[] };
  if (idx.length < 2 || segments.length === 0) return empty;
  const overlays = detectOverlays(frames, idx, seams, header, footer);
  if (overlays.length === 0) return empty;

  const runOf = new Map<number, number>();
  const scrollOf = new Map<number, number>();
  let run = 0;
  let scroll = 0;
  runOf.set(idx[0]!, 0);
  scrollOf.set(idx[0]!, 0);
  for (let i = 1; i < idx.length; i += 1) {
    const prev = frames[idx[i - 1]!];
    const cur = frames[idx[i]!];
    const match = seams[i - 1]?.match;
    if (match && prev && cur && prev.height === cur.height) {
      scroll += match.d;
    } else {
      run += 1;
      scroll = 0;
    }
    runOf.set(idx[i]!, run);
    scrollOf.set(idx[i]!, scroll);
  }

  const placed: { frame: number; srcFrom: number; srcTo: number; outFrom: number }[] = [];
  let outY = 0;
  for (const seg of segments) {
    placed.push({ frame: seg.frame, srcFrom: seg.from, srcTo: seg.to, outFrom: outY });
    outY += seg.to - seg.from;
  }

  const H0 = frames[idx[0]!]!.height;
  const findOutY = (runId: number, page: number): number | null => {
    for (const p of placed) {
      if (runOf.get(p.frame) !== runId) continue;
      const f = frames[p.frame];
      if (!f || f.height !== H0) continue;
      const sc = scrollOf.get(p.frame) ?? 0;
      const srcY = header + page - sc;
      if (srcY < header || srcY >= H0 - footer) continue;
      if (srcY >= p.srcFrom && srcY < p.srcTo) return p.outFrom + (srcY - p.srcFrom);
    }
    return null;
  };

  const stamps: OverlayStamp[] = [];
  const stampCover = new Map<number, ScreenRect[]>();
  for (const overlay of overlays) {
    let last = -1;
    let runId = 0;
    for (let i = idx.length - 1; i >= 0; i -= 1) {
      const frame = idx[i]!;
      const f = frames[frame];
      if (f && f.height === H0) {
        last = frame;
        runId = runOf.get(frame) ?? 0;
        break;
      }
    }
    if (last < 0) continue;
    const y0 = Math.max(overlay.y0, header);
    const y1 = Math.min(overlay.y1, H0 - footer);
    if (y1 <= y0) continue;
    const sc = scrollOf.get(last) ?? 0;
    const page = sc + (y0 - header);
    const at = findOutY(runId, page);
    if (at == null) continue;
    stamps.push({
      outX: overlay.x0,
      outY: at,
      width: overlay.x1 - overlay.x0,
      height: y1 - y0,
      frame: last,
      srcX: overlay.x0,
      srcY: y0,
    });
    const list = stampCover.get(runId) ?? [];
    list.push({ x0: overlay.x0, x1: overlay.x1, y0: at, y1: at + (y1 - y0) });
    stampCover.set(runId, list);
  }

  const findDonor = (
    runId: number,
    page: number,
    overlay: ScreenRect,
  ): { frame: number; srcY: number } | null => {
    let best: { frame: number; srcY: number; score: number } | null = null;
    const mid = header + (H0 - footer - header) / 2;
    for (let i = 0; i < idx.length; i += 1) {
      const frame = idx[i]!;
      if (runOf.get(frame) !== runId) continue;
      const f = frames[frame];
      if (!f || f.height !== H0) continue;
      const sc = scrollOf.get(frame) ?? 0;
      const srcY = header + page - sc;
      if (srcY < header || srcY >= H0 - footer) continue;
      if (srcY >= overlay.y0 && srcY < overlay.y1) continue;
      const score = Math.abs(srcY - mid);
      if (!best || score < best.score) best = { frame, srcY, score };
    }
    return best ? { frame: best.frame, srcY: best.srcY } : null;
  };

  const coveredByStamp = (runId: number, outRow: number, x0: number, x1: number): boolean => {
    for (const s of stampCover.get(runId) ?? []) {
      if (outRow >= s.y0 && outRow < s.y1 && x0 < s.x1 && x1 > s.x0) return true;
    }
    return false;
  };

  const repairs: ColumnRepair[] = [];
  const pushRepair = (r: ColumnRepair) => {
    const prev = repairs[repairs.length - 1];
    if (
      prev &&
      prev.frame === r.frame &&
      prev.x0 === r.x0 &&
      prev.x1 === r.x1 &&
      prev.outY1 === r.outY0 &&
      prev.srcY0 + (prev.outY1 - prev.outY0) === r.srcY0
    ) {
      prev.outY1 = r.outY1;
      return;
    }
    repairs.push(r);
  };

  for (const p of placed) {
    const f = frames[p.frame];
    if (!f || f.height !== H0) continue;
    const runId = runOf.get(p.frame);
    if (runId === undefined) continue;
    const sc = scrollOf.get(p.frame) ?? 0;
    for (const overlay of overlays) {
      const y0 = Math.max(p.srcFrom, overlay.y0, header);
      const y1 = Math.min(p.srcTo, overlay.y1, H0 - footer);
      for (let srcY = y0; srcY < y1; srcY += 1) {
        const page = sc + (srcY - header);
        const outRow = p.outFrom + (srcY - p.srcFrom);
        if (coveredByStamp(runId, outRow, overlay.x0, overlay.x1)) continue;
        const donor = findDonor(runId, page, overlay);
        if (!donor) continue;
        pushRepair({
          outY0: outRow,
          outY1: outRow + 1,
          x0: overlay.x0,
          x1: overlay.x1,
          frame: donor.frame,
          srcY0: donor.srcY,
        });
      }
    }
  }
  return { repairs, stamps };
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
      repairs: [],
      stamps: [],
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
  const fix = planOverlayFix(frames, idx, seams, header, footer, segments);
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
    repairs: fix.repairs,
    stamps: fix.stamps,
  };
}

/**
 * Stream the planned segments into a row writer. `decode` must deliver
 * the frame's RGBA rows in order (it may stop after `stopAfterRow`). Each
 * frame is decoded once, in segment order, so memory stays at one frame.
 */
export async function emitSegments(
  analysis: Pick<StitchAnalysis, 'segments'> & Partial<Pick<StitchAnalysis, 'repairs' | 'stamps'>>,
  decode: (
    frame: number,
    onRow: (y: number, rgba: Uint8Array) => void,
    stopAfterRow: number,
  ) => Promise<void>,
  writeRow: (rgba: Uint8Array) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const repairs = analysis.repairs ?? [];
  const stamps = analysis.stamps ?? [];
  const cache = new Map<string, Uint8Array>();
  if (repairs.length > 0 || stamps.length > 0) {
    const byFrame = new Map<number, Map<number, { x0: number; x1: number }[]>>();
    const add = (frame: number, y: number, x0: number, x1: number) => {
      if (y < 0 || x1 <= x0) return;
      let rows = byFrame.get(frame);
      if (!rows) {
        rows = new Map();
        byFrame.set(frame, rows);
      }
      const list = rows.get(y);
      if (list) list.push({ x0, x1 });
      else rows.set(y, [{ x0, x1 }]);
    };
    for (const r of repairs) {
      for (let i = 0; i < r.outY1 - r.outY0; i += 1) add(r.frame, r.srcY0 + i, r.x0, r.x1);
    }
    for (const s of stamps) {
      for (let i = 0; i < s.height; i += 1) add(s.frame, s.srcY + i, s.srcX, s.srcX + s.width);
    }
    for (const [frame, rows] of byFrame) {
      let maxY = 0;
      for (const y of rows.keys()) if (y > maxY) maxY = y;
      await decode(
        frame,
        (y, rgba) => {
          const needs = rows.get(y);
          if (!needs) return;
          for (const n of needs) {
            const key = `${frame}:${y}:${n.x0}:${n.x1}`;
            if (!cache.has(key)) cache.set(key, rgba.slice(n.x0 * 4, n.x1 * 4));
          }
        },
        maxY,
      );
    }
  }

  const repairAt = new Map<number, ColumnRepair[]>();
  for (const r of repairs) {
    for (let y = r.outY0; y < r.outY1; y += 1) {
      const list = repairAt.get(y);
      if (list) list.push(r);
      else repairAt.set(y, [r]);
    }
  }
  const stampAt = new Map<number, OverlayStamp[]>();
  for (const s of stamps) {
    for (let y = s.outY; y < s.outY + s.height; y += 1) {
      const list = stampAt.get(y);
      if (list) list.push(s);
      else stampAt.set(y, [s]);
    }
  }

  let written = 0;
  let outY = 0;
  const total = analysis.segments.length;
  for (let i = 0; i < total; i += 1) {
    const seg = analysis.segments[i]!;
    await decode(
      seg.frame,
      (y, rgba) => {
        if (y < seg.from || y >= seg.to) return;
        const rs = repairAt.get(outY);
        const ss = stampAt.get(outY);
        let row = rgba;
        if ((rs && rs.length > 0) || (ss && ss.length > 0)) {
          row = rgba.slice();
          if (rs) {
            for (const r of rs) {
              const srcY = r.srcY0 + (outY - r.outY0);
              const pix = cache.get(`${r.frame}:${srcY}:${r.x0}:${r.x1}`);
              if (pix) row.set(pix, r.x0 * 4);
            }
          }
          if (ss) {
            for (const s of ss) {
              const srcY = s.srcY + (outY - s.outY);
              const pix = cache.get(`${s.frame}:${srcY}:${s.srcX}:${s.srcX + s.width}`);
              if (pix) row.set(pix, s.outX * 4);
            }
          }
        }
        writeRow(row);
        written += 1;
        outY += 1;
      },
      seg.to - 1,
    );
    onProgress?.(i + 1, total);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Hiding private details: pixelate rectangles while rows stream out.
// ---------------------------------------------------------------------------

export interface Redaction {
  /** Output-image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Block size for pixelation: coarse enough that text can't be read. */
export function pixelBlock(imageWidth: number): number {
  return Math.max(12, Math.round(imageWidth / 36));
}

/**
 * Streams rows through, replacing every rectangle with flat blocks of
 * its own average colour. Buffers one band of `block` rows at a time, so
 * memory stays tiny even for an image tens of thousands of rows tall.
 * Blocks are aligned to the image grid; a rectangle is padded out to
 * whole blocks so no sliver of the original survives at its edges.
 */
export class PixelateSink {
  private band: Uint8Array[] = [];
  private bandStart = 0;
  private readonly rects: Redaction[];
  private readonly width: number;
  private readonly block: number;
  private readonly forward: (rgba: Uint8Array) => void;

  constructor(
    width: number,
    rects: Redaction[],
    block: number,
    forward: (rgba: Uint8Array) => void,
  ) {
    this.width = width;
    this.block = block;
    this.forward = forward;
    this.rects = rects
      .map((r) => ({
        x: Math.max(0, Math.floor(r.x / block) * block),
        y: Math.max(0, Math.floor(r.y / block) * block),
        width: 0,
        height: 0,
        x2: Math.min(width, Math.ceil((r.x + r.width) / block) * block),
        y2: Math.ceil((r.y + r.height) / block) * block,
      }))
      .filter((r) => r.x2 > r.x && r.y2 > r.y)
      .map((r) => ({ x: r.x, y: r.y, width: r.x2 - r.x, height: r.y2 - r.y }));
  }

  writeRow(rgba: Uint8Array): void {
    this.band.push(rgba.slice(0, this.width * 4));
    if (this.band.length === this.block) this.flushBand();
  }

  finish(): void {
    if (this.band.length > 0) this.flushBand();
  }

  private flushBand(): void {
    const y0 = this.bandStart;
    const y1 = y0 + this.band.length;
    for (const r of this.rects) {
      if (r.y >= y1 || r.y + r.height <= y0) continue;
      for (let bx = r.x; bx < r.x + r.width; bx += this.block) {
        const xEnd = Math.min(bx + this.block, r.x + r.width, this.width);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (const row of this.band) {
          for (let x = bx; x < xEnd; x += 1) {
            sr += row[x * 4]!;
            sg += row[x * 4 + 1]!;
            sb += row[x * 4 + 2]!;
            n += 1;
          }
        }
        if (n === 0) continue;
        const cr = Math.round(sr / n);
        const cg = Math.round(sg / n);
        const cb = Math.round(sb / n);
        for (const row of this.band) {
          for (let x = bx; x < xEnd; x += 1) {
            row[x * 4] = cr;
            row[x * 4 + 1] = cg;
            row[x * 4 + 2] = cb;
          }
        }
      }
    }
    for (const row of this.band) this.forward(row);
    this.bandStart = y1;
    this.band = [];
  }
}
