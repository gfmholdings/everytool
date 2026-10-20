import { File, FileMode, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { decodePngRows, PngStreamWriter, readPngSize } from './deflate';
import {
  analyzeFrames,
  emitSegments,
  FEATURE_COLS,
  FeatureBuilder,
  PixelateSink,
  pixelBlock,
  type FrameFeatures,
  type Redaction,
  type Segment,
} from './stitchCore';
import { stitchWidth } from './stitchMath';

export type { Redaction };

export interface ShotInput {
  uri: string;
  /** 0 when unknown (e.g. a file from the share sheet) — measured here. */
  width: number;
  height: number;
}

export interface StitchFrame {
  uri: string;
  width: number;
  height: number;
}

export interface StitchResult {
  uri: string;
  width: number;
  height: number;
  bytes: number;
  /** Seams with no credible overlap — stacked whole, in order. */
  stackedSeams: number;
  /** Kept for API compatibility: true when any seam was stacked. */
  stacked: boolean;
  duplicates: number;
  trimmed: number;
  /** The normalized frames + segments, for a memory-light preview. */
  frames: StitchFrame[];
  segments: Segment[];
  /** Areas hidden (pixelated) in the written image. */
  redactions: Redaction[];
}

export type StitchPhase = 'preparing' | 'reading' | 'matching' | 'writing';
export type StitchProgress = (phase: StitchPhase, done: number, total: number) => void;

/** Above this height a "Copy image" would decode a huge bitmap; offer Share instead. */
export const COPY_MAX_HEIGHT = 12000;

async function isPngAtWidth(uri: string, width: number): Promise<{ width: number; height: number } | null> {
  try {
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      const head = handle.readBytes(32);
      const size = readPngSize(head);
      return size && size.width === width ? size : null;
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Bring every input to one width as PNG. Frames from Everytool's own
 * screen recording already are (≤1170 px PNG), and are used in place;
 * picked photos (HEIC/JPEG, any size) are re-encoded by the platform.
 */
async function normalize(
  inputs: ShotInput[],
  onProgress?: StitchProgress,
): Promise<StitchFrame[]> {
  const sized: ShotInput[] = [];
  for (const s of inputs) {
    if (s.width > 0 && s.height > 0) {
      sized.push(s);
    } else {
      const probe = await manipulateAsync(s.uri, [], { format: SaveFormat.PNG });
      sized.push({ uri: probe.uri, width: probe.width, height: probe.height });
    }
  }
  const width = stitchWidth(sized);
  const out: StitchFrame[] = [];
  for (let i = 0; i < sized.length; i += 1) {
    const s = sized[i]!;
    const asIs = s.width === width ? await isPngAtWidth(s.uri, width) : null;
    if (asIs) {
      out.push({ uri: s.uri, width: asIs.width, height: asIs.height });
    } else {
      const r = await manipulateAsync(s.uri, [{ resize: { width } }], {
        format: SaveFormat.PNG,
      });
      out.push({ uri: r.uri, width: r.width, height: r.height });
    }
    onProgress?.('preparing', i + 1, sized.length);
  }
  return out;
}

/**
 * Row signatures for one frame. The platform crops the frame to the
 * sampled band and squeezes it to FEATURE_COLS px wide (full height), so
 * JS decodes a 48-px-wide image instead of a 1170-px one.
 */
async function frameFeatures(frame: StitchFrame): Promise<FrameFeatures> {
  const originX = Math.floor(frame.width * 0.03);
  const cropWidth = Math.max(FEATURE_COLS, Math.floor(frame.width * 0.89));
  const narrow = await manipulateAsync(
    frame.uri,
    [
      { crop: { originX, originY: 0, width: cropWidth, height: frame.height } },
      { resize: { width: FEATURE_COLS, height: frame.height } },
    ],
    { format: SaveFormat.PNG },
  );
  const bytes = await new File(narrow.uri).bytes();
  const builder = new FeatureBuilder(frame.width, frame.height, true);
  decodePngRows(bytes, (y, rgba) => builder.addRow(y, rgba));
  try {
    new File(narrow.uri).delete();
  } catch {
    // cache cleanup is best effort
  }
  return builder.result();
}

/** Buffered file sink: fewer, larger native writes. */
function fileSink(file: File) {
  const handle = file.open(FileMode.WriteOnly);
  const buf = new Uint8Array(1024 * 1024);
  let len = 0;
  let total = 0;
  const flush = () => {
    if (len > 0) {
      handle.writeBytes(buf.slice(0, len));
      len = 0;
    }
  };
  return {
    write(bytes: Uint8Array) {
      total += bytes.length;
      if (bytes.length >= buf.length) {
        flush();
        handle.writeBytes(bytes);
        return;
      }
      if (len + bytes.length > buf.length) flush();
      buf.set(bytes, len);
      len += bytes.length;
    },
    close() {
      flush();
      handle.close();
    },
    get bytes() {
      return total;
    },
  };
}

/**
 * Stitch frames (a screen recording) or picked screenshots into one long
 * PNG. No height limit: rows stream from each source straight into a
 * compressed PNG on disk, one frame in memory at a time.
 */
export async function stitchFrames(
  inputs: ShotInput[],
  opts: { mode: 'record' | 'photos'; onProgress?: StitchProgress },
): Promise<StitchResult> {
  if (inputs.length === 0) throw new Error('Nothing to stitch yet.');
  if (opts.mode === 'photos' && inputs.length < 2) {
    throw new Error('Add at least two screenshots to stitch.');
  }
  const frames = await normalize(inputs, opts.onProgress);

  const features: FrameFeatures[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    features.push(await frameFeatures(frames[i]!));
    opts.onProgress?.('reading', i + 1, frames.length);
  }

  opts.onProgress?.('matching', 0, 1);
  const analysis = analyzeFrames(features, { mode: opts.mode });
  opts.onProgress?.('matching', 1, 1);
  if (analysis.height <= 0) throw new Error('Nothing to stitch.');

  const outFile = new File(Paths.cache, `long-screenshot-${Date.now().toString(36)}.png`);
  if (outFile.exists) outFile.delete();
  outFile.create();
  const sink = fileSink(outFile);
  try {
    const writer = new PngStreamWriter(sink, analysis.width, analysis.height);
    await emitSegments(
      analysis,
      async (frame, onRow, stopAfterRow) => {
        const bytes = await new File(frames[frame]!.uri).bytes();
        decodePngRows(bytes, onRow, stopAfterRow);
      },
      (rgba) => writer.writeRow(rgba),
      (done, total) => opts.onProgress?.('writing', done, total),
    );
    writer.finish();
  } catch (e) {
    sink.close();
    try {
      outFile.delete();
    } catch {
      // ignore
    }
    throw e;
  }
  sink.close();

  return {
    uri: outFile.uri,
    width: analysis.width,
    height: analysis.height,
    bytes: sink.bytes,
    stackedSeams: analysis.stackedSeams,
    stacked: analysis.stackedSeams > 0,
    duplicates: analysis.duplicates,
    trimmed: analysis.trimmed,
    frames,
    segments: analysis.segments,
    redactions: [],
  };
}

/**
 * Write the stitched image again with the given areas pixelated ("Hide
 * details"). Uses the same frames and seams, so it is exact and fast —
 * no re-matching. Returns a new result; the previous file is kept until
 * the cache is cleared.
 */
export async function renderStitch(
  result: StitchResult,
  redactions: Redaction[],
  onProgress?: StitchProgress,
): Promise<StitchResult> {
  const outFile = new File(Paths.cache, `long-screenshot-${Date.now().toString(36)}.png`);
  if (outFile.exists) outFile.delete();
  outFile.create();
  const sink = fileSink(outFile);
  try {
    const writer = new PngStreamWriter(sink, result.width, result.height);
    const pix = new PixelateSink(result.width, redactions, pixelBlock(result.width), (row) =>
      writer.writeRow(row),
    );
    await emitSegments(
      result,
      async (frame, onRow, stopAfterRow) => {
        const bytes = await new File(result.frames[frame]!.uri).bytes();
        decodePngRows(bytes, onRow, stopAfterRow);
      },
      (rgba) => pix.writeRow(rgba),
      (done, total) => onProgress?.('writing', done, total),
    );
    pix.finish();
    writer.finish();
  } catch (e) {
    sink.close();
    try {
      outFile.delete();
    } catch {
      // ignore
    }
    throw e;
  }
  sink.close();
  return { ...result, uri: outFile.uri, bytes: sink.bytes, redactions };
}

/** Picked screenshots, kept in the order given. */
export function stitchShots(
  shots: ShotInput[],
  onProgress?: StitchProgress,
): Promise<StitchResult> {
  return stitchFrames(shots, { mode: 'photos', onProgress });
}

/** Frames the broadcast extension left in the App Group inbox. */
export function stitchRecordedFrames(
  frames: ShotInput[],
  onProgress?: StitchProgress,
): Promise<StitchResult> {
  return stitchFrames(frames, { mode: 'record', onProgress });
}
