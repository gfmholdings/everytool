import { File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { decodePngRows } from './deflate';
import { tempFileUri } from './files';
import {
  buildPalette,
  encodeGif,
  GIF_WIDTH,
  quantizeFrame,
  planGif,
  quantizeWithPalette,
} from './gifenc';

// Video to GIF: pick where to start and how long, frame rate and width;
// frames are sampled with expo-video-thumbnails and coloured with one
// adaptive palette for the whole clip plus ordered dithering ("Best"),
// or the old fixed palette ("Fast"). Encoded as a real GIF89a.

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
  /** 'best' = adaptive palette + dithering; 'fast' = fixed palette. */
  colour?: 'best' | 'fast';
  toPng: (jpegUri: string, width: number) => Promise<{ uri: string; width: number; height: number }>;
  onProgress?: (done: number, total: number) => void;
}

/** Memory guard: RGBA frames kept for the adaptive palette. */
const MAX_PIXELS = 36_000_000;

/**
 * Sample a stretch of a video into a GIF. Frames come from
 * expo-video-thumbnails (JPEG stills at timestamps); the caller turns each
 * into a PNG at the target width (expo-image-manipulator), decoded here.
 */
export async function makeGifFromVideo(videoUri: string, opts: GifOptions): Promise<GifResult> {
  const width = Math.max(120, Math.min(640, Math.round(opts.width ?? GIF_WIDTH)));
  const plan = planGif(opts);
  let times = plan.times;
  const rgbaFrames: Uint8Array[] = [];
  const indexed: Uint8Array[] = [];
  const best = (opts.colour ?? 'best') === 'best';
  let height = 0;
  for (let i = 0; i < times.length; i += 1) {
    const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: times[i]!,
      quality: 0.8,
    });
    const png = await opts.toPng(thumb.uri, width);
    const bytes = await new File(png.uri).bytes();
    const rgba = new Uint8Array(png.width * png.height * 4);
    decodePngRows(bytes, (y, row) => {
      rgba.set(row, y * png.width * 4);
    });
    if (i === 0) {
      height = png.height;
      // keep memory bounded: fewer frames for big/long GIFs
      const maxFrames = Math.max(8, Math.floor(MAX_PIXELS / (png.width * png.height)));
      if (best && times.length > maxFrames) {
        const step = times.length / maxFrames;
        times = Array.from({ length: maxFrames }, (_, k) => times[Math.floor(k * step)]!);
      }
    }
    if (png.width !== width || png.height !== height) continue; // odd frame size: skip
    if (best) rgbaFrames.push(rgba);
    else indexed.push(quantizeFrame(rgba));
    opts.onProgress?.(i + 1, times.length);
  }
  if (best && rgbaFrames.length === 0) throw new Error('No frames could be read from that video.');
  if (!best && indexed.length === 0) throw new Error('No frames could be read from that video.');
  let palette: Uint8Array | undefined;
  let frames = indexed;
  if (best) {
    palette = buildPalette(rgbaFrames);
    const cache = new Int16Array(32768).fill(-1);
    frames = rgbaFrames.map((f) => quantizeWithPalette(f, width, palette!, true, cache));
  }
  const delay = Math.round((100 * (times.length > 1 ? (times[1]! - times[0]!) / 1000 : 1 / plan.fps)));
  const gif = encodeGif(frames, width, height, Math.max(2, delay), palette);
  const uri = tempFileUri('gif', 'everytool-gif');
  new File(uri).write(gif);
  return { uri, width, height, frames: frames.length, bytes: gif.length };
}
