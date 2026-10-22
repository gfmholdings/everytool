import { File } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { tempFileUri } from './files';
import {
  gifDelayCs,
  gifFromRgba,
  GIF_WIDTH,
  planGif,
  quantizeFrame,
  encodeGif,
} from './gifenc';

// Video → GIF. Frames are sampled natively as 8-bit sRGB RGBA
// (AVAssetImageGenerator, preferred transform, zero tolerance) and
// quantized here. There is no PNG/JPEG/HEIC round-trip: iOS stills of
// HEVC, HDR, and Display P3 clips are often 16-bit, and the PNG decoder
// rejects those with "Unsupported PNG format."

export { encodeGif, GIF_FPS, GIF_MAX_SECONDS, GIF_WIDTH, planGif } from './gifenc';

export interface GifResult {
  uri: string;
  width: number;
  height: number;
  frames: number;
  bytes: number;
}

export interface GifOptions {
  /** Clip length in seconds (for clamping). */
  durationSec: number;
  /** Where to start, seconds. Default 0. */
  startSec?: number;
  /** How long, seconds. Default GIF_MAX_SECONDS, max 10. */
  lengthSec?: number;
  fps?: number;
  width?: number;
  /** Oriented pixel size of the source, for the memory cap. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** 'best' = adaptive palette + dithering; 'fast' = fixed palette. */
  colour?: 'best' | 'fast';
  onProgress?: (done: number, total: number) => void;
}

interface SampledFrame {
  uri: string;
  width: number;
  height: number;
  timeMs: number;
}

interface VideoFrameSampler {
  sampleVideoFrames?(
    videoUri: string,
    timesMs: number[],
    maxWidth: number,
  ): Promise<SampledFrame[]>;
}

/** Memory guard: RGBA frames kept for the adaptive palette. */
const MAX_PIXELS = 36_000_000;
const SAMPLE_BATCH = 8;

/**
 * Sample a stretch of a video into a GIF. Requires the native frame
 * sampler; an older binary is told to update instead of being sent down
 * the PNG path that produced the owner's error.
 */
export async function makeGifFromVideo(videoUri: string, opts: GifOptions): Promise<GifResult> {
  const width = Math.max(120, Math.min(640, Math.round(opts.width ?? GIF_WIDTH)));
  const plan = planGif(opts);
  const best = (opts.colour ?? 'best') === 'best';
  let times = plan.times;
  if (best) {
    const srcW = opts.sourceWidth && opts.sourceWidth > 0 ? opts.sourceWidth : width;
    const srcH = opts.sourceHeight && opts.sourceHeight > 0 ? opts.sourceHeight : width * 2;
    const outH = Math.max(1, Math.round(width * (srcH / srcW)));
    const maxFrames = Math.max(8, Math.floor(MAX_PIXELS / (width * outH)));
    if (times.length > maxFrames) {
      const step = times.length / maxFrames;
      times = Array.from({ length: maxFrames }, (_, k) => times[Math.floor(k * step)]!);
    }
  }

  const native = requireOptionalNativeModule<VideoFrameSampler>('EverytoolSharedVault');
  if (!native?.sampleVideoFrames) {
    throw new Error('This build can’t read video frames. Update Everytool and try again.');
  }
  const sample = native.sampleVideoFrames.bind(native);

  const rgbaFrames: Uint8Array[] = [];
  const indexed: Uint8Array[] = [];
  const keptTimes: number[] = [];
  let frameW = 0;
  let frameH = 0;
  let read = 0;
  for (let i = 0; i < times.length; i += SAMPLE_BATCH) {
    const slice = times.slice(i, i + SAMPLE_BATCH);
    const sampled = await sample(videoUri, slice, width);
    for (const frame of sampled) {
      if (frameW === 0) {
        frameW = frame.width;
        frameH = frame.height;
      }
      if (frame.width !== frameW || frame.height !== frameH || frameW < 1 || frameH < 1) {
        deleteFrame(frame.uri);
        continue;
      }
      const expected = frameW * frameH * 4;
      let raw: Uint8Array;
      try {
        raw = await new File(frame.uri).bytes();
      } finally {
        deleteFrame(frame.uri);
      }
      if (raw.length < expected) continue;
      const copy = new Uint8Array(expected);
      copy.set(raw.subarray(0, expected));
      keptTimes.push(frame.timeMs);
      if (best) rgbaFrames.push(copy);
      else indexed.push(quantizeFrame(copy));
    }
    read += slice.length;
    opts.onProgress?.(Math.min(times.length, read), times.length);
  }

  const count = best ? rgbaFrames.length : indexed.length;
  if (count === 0 || frameW < 1 || frameH < 1) {
    throw new Error('No frames could be read from that video.');
  }
  const delay = gifDelayCs(keptTimes, plan.fps);
  const gif = best
    ? gifFromRgba(rgbaFrames, frameW, frameH, delay, 'best')
    : encodeGif(indexed, frameW, frameH, delay);
  const uri = tempFileUri('gif', 'everytool-gif');
  new File(uri).write(gif);
  return { uri, width: frameW, height: frameH, frames: count, bytes: gif.length };
}

function deleteFrame(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // The cache copy is only a convenience. The GIF already has the pixels.
  }
}
