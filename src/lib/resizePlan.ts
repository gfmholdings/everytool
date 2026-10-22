// File-size targeting for Resize. Pure: the caller supplies `measure`,
// which is either a live estimate or a real on-device encode. Nothing
// here talks to the network.

export const QUALITY_FLOOR = 0.4;
export const QUALITY_CEILING = 0.92;
/** Smallest long side the downscale fallback will try. */
export const MIN_LONG_SIDE = 160;

export type ResizeFormat = 'jpeg' | 'png' | 'heic';
export type SizeUnit = 'KB' | 'MB';

/**
 * Portal sizes first, then the same upload limits PDF compress offers
 * from 500 KB through 25 MB (PDF_TARGET_CHIPS). A 50 KB photo chip is
 * not a useful PDF target, so it stays only on this list.
 */
export const SIZE_CHIPS = [
  { id: '50kb', label: '50 KB', bytes: 50 * 1024 },
  { id: '100kb', label: '100 KB', bytes: 100 * 1024 },
  { id: '200kb', label: '200 KB', bytes: 200 * 1024 },
  { id: '500kb', label: '500 KB', bytes: 500 * 1024 },
  { id: '1mb', label: '1 MB', bytes: 1024 * 1024 },
  { id: '2mb', label: '2 MB', bytes: 2 * 1024 * 1024 },
  { id: '5mb', label: '5 MB', bytes: 5 * 1024 * 1024 },
  { id: '10mb', label: '10 MB', bytes: 10 * 1024 * 1024 },
  { id: '20mb', label: '20 MB', bytes: 20 * 1024 * 1024 },
  { id: '25mb', label: '25 MB', bytes: 25 * 1024 * 1024 },
] as const;

/** Portal file-size limits shown next to the dimension presets. */
export const PASSPORT_LIMITS = [
  {
    id: 'passport-240',
    label: 'Passport',
    width: 600,
    bytes: 240 * 1024,
    note: 'under 240 KB — common visa and passport portals',
  },
  {
    id: 'passport-100',
    label: 'Passport strict',
    width: 413,
    bytes: 100 * 1024,
    note: 'under 100 KB — stricter portals',
  },
] as const;

export interface FitStep {
  width: number;
  height: number;
  /** 0–1. PNG ignores it and is always stored at 1. */
  quality: number;
}

export interface FitInput {
  sourceWidth: number;
  sourceHeight: number;
  /** Null keeps the source width (compress-only when downscale is off). */
  targetWidth: number | null;
  /** Null means no file-size target — one encode at `preferredQuality`. */
  maxBytes: number | null;
  format: ResizeFormat;
  /** When false, never shrink below the chosen width. */
  allowDownscale: boolean;
  /** Used when there is no size target, and as the top of the search. */
  preferredQuality?: number;
}

export interface FitPlan {
  width: number;
  height: number;
  quality: number;
  format: ResizeFormat;
  bytes: number;
  /** The chosen width cannot meet maxBytes even at the quality floor. */
  unmetAtDimensions: boolean;
  /** The plan had to use a smaller width than the one requested. */
  downscaled: boolean;
  /** Still over maxBytes after the quality floor and any allowed shrink. */
  unmet: boolean;
}

export function parseSizeTarget(amount: string, unit: SizeUnit): number | null {
  const n = Number(amount.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const bytes = unit === 'MB' ? n * 1024 * 1024 : n * 1024;
  if (bytes > 200 * 1024 * 1024) return null;
  return Math.round(bytes);
}

export function limitLabel(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Integer pixel size. Never upscales, never uses a fractional edge. */
export function outputSize(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.min(sourceWidth, Math.round(width)));
  const h = Math.max(1, Math.round((sourceHeight * w) / Math.max(1, sourceWidth)));
  return { width: w, height: h };
}

/**
 * Instant size guess for the live readout. JPEG/HEIC grow with quality;
 * PNG does not. The real encode replaces this number before Save.
 */
export function estimateOutputBytes(
  width: number,
  height: number,
  quality: number,
  format: ResizeFormat,
): number {
  const pixels = Math.max(1, width) * Math.max(1, height);
  if (format === 'png') return Math.round(pixels * 0.4);
  const q = Math.min(1, Math.max(0, quality));
  const bytesPerPixel = 0.05 + 0.6 * q * q;
  const heic = format === 'heic' ? 0.65 : 1;
  return Math.max(1, Math.round(pixels * bytesPerPixel * heic));
}

function snapQuality(q: number): number {
  const clamped = Math.min(QUALITY_CEILING, Math.max(QUALITY_FLOOR, q));
  return Math.round(clamped * 100) / 100;
}

function startWidth(input: FitInput): number {
  const wanted = input.targetWidth ?? input.sourceWidth;
  return outputSize(input.sourceWidth, input.sourceHeight, wanted).width;
}

/** Width that brings the long side down to MIN_LONG_SIDE, without upscaling. */
function minTargetWidth(sourceWidth: number, sourceHeight: number): number {
  if (sourceWidth >= sourceHeight) return Math.min(sourceWidth, MIN_LONG_SIDE);
  return Math.max(1, Math.round((sourceWidth * MIN_LONG_SIDE) / Math.max(1, sourceHeight)));
}

function read(measure: (step: FitStep) => number, step: FitStep): number {
  return Math.max(0, Math.round(measure(step)));
}

/** Highest quality in [floor, ceiling] whose encode is within maxBytes.
 *  Returns the floor attempt when even that is over. */
function highestQuality(
  size: { width: number; height: number },
  ceiling: number,
  maxBytes: number,
  format: ResizeFormat,
  measure: (step: FitStep) => number,
): { quality: number; bytes: number } {
  if (format === 'png') {
    const bytes = read(measure, { ...size, quality: 1 });
    return { quality: 1, bytes };
  }
  const floorQ = snapQuality(QUALITY_FLOOR);
  const ceilQ = snapQuality(Math.max(QUALITY_FLOOR, ceiling));
  const floorBytes = read(measure, { ...size, quality: floorQ });
  if (floorBytes > maxBytes) return { quality: floorQ, bytes: floorBytes };
  let lo = Math.round(floorQ * 100);
  let hi = Math.round(ceilQ * 100);
  let bestQ = floorQ;
  let bestBytes = floorBytes;
  for (let i = 0; i < 8 && lo < hi; i += 1) {
    const mid = Math.ceil((lo + hi) / 2);
    const quality = snapQuality(mid / 100);
    const bytes = read(measure, { ...size, quality });
    if (bytes <= maxBytes) {
      bestQ = quality;
      bestBytes = bytes;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { quality: bestQ, bytes: bestBytes };
}

/**
 * Pick integer dimensions and a JPEG/HEIC quality (or PNG as-is) so the
 * file lands under `maxBytes` when that is possible.
 * Quality is binary-searched. If the floor (~0.4) is still too big and
 * downscaling is allowed, the long side is binary-searched downward.
 */
export function fitToMaxBytes(input: FitInput, measure: (step: FitStep) => number): FitPlan {
  const format = input.format;
  const preferred = snapQuality(input.preferredQuality ?? QUALITY_CEILING);
  const empty: FitPlan = {
    width: 1,
    height: 1,
    quality: format === 'png' ? 1 : preferred,
    format,
    bytes: 0,
    unmetAtDimensions: false,
    downscaled: false,
    unmet: false,
  };
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) return empty;

  const chosen = outputSize(input.sourceWidth, input.sourceHeight, startWidth(input));
  if (input.maxBytes == null || input.maxBytes <= 0) {
    const quality = format === 'png' ? 1 : preferred;
    const bytes = read(measure, { ...chosen, quality });
    return { ...empty, ...chosen, quality, bytes };
  }

  const atChoice = highestQuality(chosen, preferred, input.maxBytes, format, measure);
  if (atChoice.bytes <= input.maxBytes) {
    return {
      ...empty,
      ...chosen,
      quality: atChoice.quality,
      bytes: atChoice.bytes,
    };
  }

  if (!input.allowDownscale) {
    return {
      ...empty,
      ...chosen,
      quality: atChoice.quality,
      bytes: atChoice.bytes,
      unmetAtDimensions: true,
      unmet: true,
    };
  }

  const minSide = Math.min(minTargetWidth(input.sourceWidth, input.sourceHeight), chosen.width);
  let lo = minSide;
  let hi = chosen.width - 1;
  let fitWidth = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const size = outputSize(input.sourceWidth, input.sourceHeight, mid);
    const quality = format === 'png' ? 1 : snapQuality(QUALITY_FLOOR);
    const bytes = read(measure, { ...size, quality });
    if (bytes <= input.maxBytes) {
      fitWidth = size.width;
      lo = size.width + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (fitWidth === 0) {
    const smallest = outputSize(input.sourceWidth, input.sourceHeight, minSide);
    const quality = format === 'png' ? 1 : snapQuality(QUALITY_FLOOR);
    const bytes = read(measure, { ...smallest, quality });
    return {
      ...empty,
      ...smallest,
      quality,
      bytes,
      unmetAtDimensions: true,
      downscaled: smallest.width < chosen.width,
      unmet: true,
    };
  }

  const shrunk = outputSize(input.sourceWidth, input.sourceHeight, fitWidth);
  const fitted = highestQuality(shrunk, preferred, input.maxBytes, format, measure);
  return {
    ...empty,
    ...shrunk,
    quality: fitted.quality,
    bytes: fitted.bytes,
    unmetAtDimensions: true,
    downscaled: shrunk.width < chosen.width,
    unmet: fitted.bytes > input.maxBytes,
  };
}

class ProbeMiss extends Error {
  step: FitStep;
  constructor(step: FitStep) {
    super('probe');
    this.step = step;
  }
}

/**
 * Same plan as fitToMaxBytes, but each unseen encode is awaited. Used
 * when `measure` writes a real file. Offline; the caller does the encode.
 */
export async function fitToMaxBytesAsync(
  input: FitInput,
  measure: (step: FitStep) => Promise<number>,
): Promise<FitPlan> {
  const cache = new Map<string, number>();
  const key = (step: FitStep) => `${step.width}x${step.height}@${step.quality}`;
  for (;;) {
    try {
      return fitToMaxBytes(input, (step) => {
        const hit = cache.get(key(step));
        if (hit == null) throw new ProbeMiss(step);
        return hit;
      });
    } catch (e) {
      if (!(e instanceof ProbeMiss)) throw e;
      cache.set(key(e.step), Math.max(0, Math.round(await measure(e.step))));
    }
  }
}

/** Warning for a plan that missed the size target. Null when it fits. */
export function fitWarning(plan: FitPlan, requestedWidth: number, maxBytes: number): string | null {
  if (!plan.unmet && !plan.unmetAtDimensions) return null;
  const limit = limitLabel(maxBytes);
  if (plan.unmet) return `Can’t get under ${limit} at these dimensions.`;
  return `${requestedWidth} px wide stays above ${limit} even at the lowest quality. Export uses ${plan.width} × ${plan.height} instead.`;
}
